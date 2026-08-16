/**
 * uPlot time-series chart over persisted ticks.
 * Re-creates the instance when colors (theme) or series change.
 */
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Tick } from '../lib/history';
import { formatCount, formatRate } from '../lib/format';
import { cssVar, useCssVars } from '../hooks/useCssVars';

export interface ChartSeriesDef {
  key: string;
  label: string;
  /** CSS custom property name (without --) providing the stroke color */
  colorVar: string;
  source: 'gauges' | 'derived';
  step?: boolean;
  /** multiply values before plotting (e.g. 100 to plot 0..1 ratios as 0–100%) */
  scale?: number;
  /** forward-fill nulls with the previous value (holds the last measured
   * rate across idle gaps instead of drawing diagonal drops) */
  fill?: 'prev';
  /**
   * dedicated y-scale key (e.g. 'y2'): series sharing a key get one
   * right-hand axis that auto-ranges independently of the main scale —
   * for mixed-magnitude series (e.g. 80 tok/s generation vs 1200 tok/s
   * prefill) that would squash each other on a shared axis.
   */
  yScale?: string;
  /**
   * render as thin bars instead of a line. Gaps between samples become
   * empty space (no ugly connector diagonals across idle periods), and
   * for dense data the series is bin-averaged (max per bucket) so bars
   * stay at least ~5px wide instead of sub-pixel.
   */
  bars?: boolean;
}

/**
 * Step-after expansion: each value holds until the next sample time so
 * constant gauges render as visible step lines instead of single points.
 * Per-series: step series get the hold segment, non-step series get a
 * single vertex per tick (null at the hold slot) so mixed charts work.
 */
function expandSteps(
  rawX: number[],
  rawCols: (number | null)[][],
  stepFlags: boolean[],
): [number[], ...(number | null)[][]] {
  const x: number[] = [];
  const cols: (number | null)[][] = rawCols.map(() => []);
  let prev: (number | null)[] | null = null;
  for (let i = 0; i < rawX.length; i++) {
    const cur = rawCols.map((col) => col[i]);
    const anyCur = cur.some((v) => v !== null);
    if (prev !== null && anyCur) {
      x.push(rawX[i]);
      cols.forEach((col, si) =>
        col.push(stepFlags[si] ? (cur[si] !== null ? prev![si] : null) : null),
      );
    }
    if (anyCur) {
      x.push(rawX[i]);
      cols.forEach((col, si) => col.push(cur[si]));
    }
    prev = cur;
  }
  return [x, ...cols];
}

/**
 * Index of the nearest x value in a non-decreasing column (step expansion
 * leaves duplicate x entries, so a plain bisect would be ambiguous).
 */
export function nearestXIndex(x: number[], val: number): number {
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] < val) lo = mid;
    else hi = mid;
  }
  return val - x[lo] <= x[hi] - val ? lo : hi;
}

function withAlpha(color: string, alpha: number): string {
  // handle #rgb/#rrggbb and rgb()/rgba()
  if (color.startsWith('#')) {
    const hex = color.length === 4
      ? '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
      : color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
  }
  return color;
}

export function TrendChart({
  series,
  ticks,
  unit = 'count',
}: {
  series: ChartSeriesDef[];
  ticks: Tick[];
  /** how to format tooltip values */
  unit?: 'rate' | 'percent' | 'count';
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const uRef = useRef<uPlot | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // the panel is user-resizable: the chart fills whatever box it is in
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  const [chartError, setChartError] = useState<string | null>(null);
  const colors = useCssVars(
    [...series.map((s) => `--${s.colorVar}`), '--chart-grid', '--text-muted', '--border'],
  );
  // an idle server produces all-null derived series — say so instead of
  // rendering an empty canvas the user can't distinguish from a bug
  const hasData = ticks.some((t) =>
    series.some((s) => {
      const v = s.source === 'gauges' ? t.gauges[s.key] : t.derived[s.key];
      return v !== undefined && v !== null && Number.isFinite(v);
    }),
  );
  const colorsKey = useMemo(
    () => JSON.stringify(colors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colors],
  );
  // content-stable identity for the series layout (the effect must not
  // re-create the instance on array identity changes)
  const seriesKey = useMemo(
    () => series.map((s) => `${s.key}:${s.colorVar}${s.step ? ':step' : ''}`).join(';'),
    [series],
  );

  const sample = (s: ChartSeriesDef, t: Tick): number | null => {
    const v = s.source === 'gauges' ? t.gauges[s.key] : t.derived[s.key];
    if (v === undefined || v === null || !Number.isFinite(v)) return null;
    return v * (s.scale ?? 1);
  };

  // hold the last measured value across nulls (leading nulls stay null)
  const forwardFill = (col: (number | null)[]): (number | null)[] => {
    let last: number | null = null;
    return col.map((v) => (v !== null ? (last = v) : last));
  };

  const formatValue = (v: number): string => {
    switch (unit) {
      case 'rate':
        return `${formatRate(v)} tok/s`;
      case 'percent':
        return `${v.toFixed(1)}%`;
      default:
        return formatCount(v);
    }
  };

  /**
   * Build the uPlot frame.
   * Sparse: exact ticks (step expansion where needed).
   * Dense (more ticks than ~5-6px buckets): bin to one point per bucket —
   * bar series take the bucket max (spike-preserving), step/fill series
   * take the bucket's last value (equivalent to holding), plain lines the
   * max. fill series then forward-fill empty buckets so their line stays
   * joined (a null bucket is a line break in uPlot). Without binning,
   * 15 min of 2s ticks would be sub-pixel bars/points.
   */
  const buildData = (): [number[], ...(number | null)[][]] => {
    const box = boxRef.current;
    const width = box ? Math.max(200, box.clientWidth) : 600;
    const target = Math.max(40, Math.floor(width / 6));

    if (ticks.length > target) {
      const t0 = ticks[0].t / 1000;
      const t1 = ticks[ticks.length - 1].t / 1000;
      const span = Math.max(1e-9, t1 - t0);
      const x: number[] = [];
      const cols: (number | null)[][] = series.map(() => []);
      let bi = -1;
      for (let i = 0; i < ticks.length; i++) {
        const b = Math.min(target - 1, Math.floor(((ticks[i].t / 1000 - t0) / span) * target));
        if (b !== bi) {
          bi = b;
          x.push(t0 + ((b + 0.5) / target) * span); // bucket center
          cols.forEach((col) => col.push(null));
        }
        series.forEach((s, si) => {
          const v = sample(s, ticks[i]);
          if (v === null) return;
          const cell = cols[si][cols[si].length - 1];
          if (s.bars || (!s.step && s.fill !== 'prev')) {
            // keep the spike
            cols[si][cols[si].length - 1] = cell === null || v > (cell as number) ? v : cell;
          } else {
            // step/fill semantics: the last value of the bucket holds
            cols[si][cols[si].length - 1] = v;
          }
        });
      }
      // hold the last measured value across buckets that had no sample at
      // all (same semantics as the sparse path's forwardFill): without this
      // a fill series breaks its line at every empty bucket — idle
      // stretches between prompts read as gaps in the chart
      for (let si = 0; si < series.length; si++) {
        if (series[si].fill === 'prev') cols[si] = forwardFill(cols[si]);
      }
      return [x, ...cols];
    }

    const anyStep = series.some((s) => s.step);
    const rawX = ticks.map((t) => t.t / 1000);
    const rawCols = series.map((s) => {
      const col = ticks.map((t) => sample(s, t));
      return s.fill === 'prev' ? forwardFill(col) : col;
    });
    // a bar series never needs step expansion (bars ARE the samples);
    // when it shares the frame with a step series, forward-fill the step
    // values instead of duplicating x (keeps the frame lengths aligned)
    if (series.some((s) => s.bars)) {
      const cols = rawCols.map((col, si) =>
        series[si].step || series[si].fill === 'prev' ? forwardFill(col) : col,
      );
      return [rawX, ...cols];
    }
    return anyStep
      ? expandSteps(rawX, rawCols, series.map((s) => !!s.step))
      : [rawX, ...rawCols];
  };

  // instance (re)creation: only when the series layout, size, theme or
  // data-emptiness changes — ticks updates go through setData() below
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const gridColor = colors['--chart-grid'];
    const muted = colors['--text-muted'];
    const borderColor = colors['--border'];

    // dedicated right-hand y-scales for series that opt in
    const extraScales = [...new Set(series.map((s) => s.yScale).filter((k): k is string => !!k))];
    const scaleKeyOf = (s: ChartSeriesDef): string => s.yScale ?? 'y';
    const firstSeriesColor = (key: string): string => {
      const s = series.find((x) => scaleKeyOf(x) === key);
      return s ? colors[`--${s.colorVar}`] : borderColor;
    };
    // NOTE: uPlot has no min/max scale options — an explicit min there
    // disables auto-ranging of max and silently maps every point to
    // NaN (invisible series). A range fn is the supported way to pin
    // the floor at zero while keeping the top auto.
    const axisRange = (_u: uPlot, dataMin: number | null, dataMax: number | null): [number, number] => {
      if (dataMin == null || dataMax == null) return [0, 1];
      const min = Math.min(0, dataMin);
      let max = Math.max(0, dataMax);
      if (max <= min) max = min + 1;
      return [min, max * 1.05];
    };

    const buildOptions = (width: number, height: number): uPlot.Options => ({
      width,
      height,
      series: [
        { label: '' },
        ...series.map((s) => {
          const color = colors[`--${s.colorVar}`];
          // bars: solid-ish bodies, no outline, uPlot's built-in bar path
          // renderer (55% of the column width, min 1px, rounded top)
          const barPaths = s.bars
            ? uPlot.paths.bars?.({ size: [0.55, Infinity, 1], radius: [2, 0] })
            : undefined;
          return {
            label: s.label,
            stroke: s.bars ? undefined : color,
            fill: withAlpha(color, s.bars ? 0.7 : 0.07),
            width: s.bars ? 0 : 2,
            ...(s.yScale ? { scale: s.yScale } : {}),
            ...(barPaths ? { paths: barPaths } : {}),
          };
        }),
      ],
      scales: {
        x: { time: true },
        y: { auto: true, range: axisRange },
        ...Object.fromEntries(extraScales.map((k) => [k, { auto: true, range: axisRange }])),
      },
      axes: [
        {
          stroke: muted,
          grid: { stroke: gridColor, width: 1 },
          font: '11px ui-sans-serif, system-ui, sans-serif',
          scale: 'x',
        },
        // y-axis labels are tinted with the first series on that scale so
        // it's obvious which axis belongs to which line
        {
          stroke: firstSeriesColor('y'),
          grid: { stroke: gridColor, width: 1 },
          font: '11px ui-sans-serif, system-ui, sans-serif',
          scale: 'y',
        },
        ...extraScales.map((k) => ({
          stroke: firstSeriesColor(k),
          grid: { stroke: 'transparent' as string, width: 1 },
          font: '11px ui-sans-serif, system-ui, sans-serif',
          scale: k,
        })),
      ],
      padding: [8, 8, 0, 4],
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        // prox >= 0 enables cursor focus (required for hover points);
        // 1e6 = always within proximity
        focus: { prox: 1e6 },
        points: { show: true, size: 5, width: 2 },
      },
      hooks: {
        // hover tooltip: time + one row per series at the nearest point
        setCursor: [
          (u: uPlot) => {
            const box = boxRef.current;
            const tip = tipRef.current;
            if (!box || !tip) return;
            const { left, top } = u.cursor;
            const xCol = u.data[0] as number[];
            // uPlot's "cursor outside the plot" is left/top = -10 (not null)
            if (left == null || top == null || left < 0 || top < 0 || xCol.length === 0) {
              tip.style.display = 'none';
              return;
            }
            const xVal = u.posToVal(left, 'x');
            const i = nearestXIndex(xCol, xVal);
            let rows = '';
            for (let si = 1; si < u.data.length; si++) {
              const v = u.data[si][i];
              if (v == null || !Number.isFinite(v)) continue;
              const color = (u.series[si] as { _stroke?: string })._stroke ?? '';
              rows +=
                `<div class="chart-tip-row"><span class="chart-tip-dot" style="background:${color}"></span>` +
                `<span class="chart-tip-label">${u.series[si].label}</span><b>${formatValue(v as number)}</b></div>`;
            }
            if (!rows) {
              tip.style.display = 'none';
              return;
            }
            const time = new Date(xVal * 1000).toLocaleTimeString('en-GB', { hour12: false });
            tip.innerHTML = `<div class="chart-tip-time">${time}</div>${rows}`;
            tip.style.display = 'block';
            const tw = tip.offsetWidth;
            const th = tip.offsetHeight;
            let px = left + 14;
            if (px + tw > box.clientWidth - 4) px = left - tw - 14;
            tip.style.left = `${Math.max(4, px)}px`;
            tip.style.top = `${Math.max(4, Math.min(top + 14, box.clientHeight - th - 4))}px`;
          },
        ],
      },
    });

    const width = box.clientWidth || 600;
    const height = box.clientHeight || 220;

    let u: uPlot;
    try {
      u = new uPlot(buildOptions(width, height), buildData(), box);
    } catch (e) {
      setChartError((e as Error).message);
      return;
    }
    uRef.current = u;

    const measure = () => setBoxSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);

    // belt & braces: the setCursor hook already hides the tooltip when the
    // cursor goes outside the plot, but a native leave catches the rest
    // (e.g. the pointer leaving the window over the axis area)
    const hideTip = () => {
      if (tipRef.current) tipRef.current.style.display = 'none';
    };
    box.addEventListener('mouseleave', hideTip);

    return () => {
      box.removeEventListener('mouseleave', hideTip);
      ro.disconnect();
      u.destroy();
      uRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey, hasData, chartError, colorsKey]);

  // panel resized: refit the existing instance (no re-creation)
  useEffect(() => {
    const u = uRef.current;
    if (u && boxSize.w > 0 && boxSize.h > 0) {
      u.setSize({ width: boxSize.w, height: boxSize.h });
    }
  }, [boxSize]);

  // tick updates: push new data into the existing instance. NOTE: do NOT
  // call u.redraw() afterwards — in uPlot 1.6.x redraw() is
  // _setScale('x', scales.x.min, scales.x.max), which re-pends the (still
  // null, pre-microtask) x range and permanently kills auto-ranging.
  // setData() alone commits scales + draws on the next microtask.
  useEffect(() => {
    const u = uRef.current;
    if (!u) return;
    u.setData(buildData());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticks]);

  return (
    <div className="chart-root">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span className="swatch" style={{ background: `var(--${s.colorVar})` }} />
            {s.label}
          </span>
        ))}
      </div>
      {chartError ? (
        <span className="muted">chart unavailable: {chartError}</span>
      ) : !hasData ? (
        <div className="chart-empty" style={{ flex: 1 }}>
          {ticks.length === 0 ? 'no data collected yet' : 'no values in this window'}
        </div>
      ) : (
        <div className="chart-stage">
          <div ref={boxRef} className="chart-box" />
          <div ref={tipRef} className="chart-tip" style={{ display: 'none' }} />
        </div>
      )}
    </div>
  );
}

export { cssVar };
