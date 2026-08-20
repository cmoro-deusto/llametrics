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
   * empty space (no ugly connector diagonals across idle periods).
   */
  bars?: boolean;
  /**
   * how this series collapses when there are more ticks than pixels:
   *  - 'peak' keeps the largest sample in the bucket, so bursts and
   *    spikes survive at wide windows (rates, requests in flight);
   *  - 'last' keeps the bucket's final sample, which is what a held
   *    ratio means — a peak would bias a percentage upward.
   * Binning is disclosed in the chart caption, because the same line
   * means different things at different widths.
   */
  bin?: 'peak' | 'last';
}

/** Bucket rule for a series, defaulting by shape when not set explicitly. */
export function binModeOf(s: ChartSeriesDef): 'peak' | 'last' {
  if (s.bin) return s.bin;
  return s.step && s.fill === 'prev' ? 'last' : 'peak';
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
  rawHeld: (number | null)[][],
): { frame: [number[], ...(number | null)[][]]; held: (number | null)[][] } {
  const x: number[] = [];
  const cols: (number | null)[][] = rawCols.map(() => []);
  const held: (number | null)[][] = rawCols.map(() => []);
  let prev: (number | null)[] | null = null;
  let prevT: number | null = null;
  for (let i = 0; i < rawX.length; i++) {
    const cur = rawCols.map((col) => col[i]);
    const anyCur = cur.some((v) => v !== null);
    if (prev !== null && anyCur) {
      x.push(rawX[i]);
      cols.forEach((col, si) =>
        col.push(stepFlags[si] ? (cur[si] !== null ? prev![si] : null) : null),
      );
      // the hold vertex repeats the previous point's value at this x, so
      // its measurement time is that point's (itself possibly inherited)
      held.forEach((col, si) => col.push(rawHeld[si][i - 1] ?? prevT));
    }
    if (anyCur) {
      x.push(rawX[i]);
      cols.forEach((col, si) => col.push(cur[si]));
      held.forEach((col, si) => col.push(rawHeld[si][i]));
    }
    prev = cur;
    prevT = rawX[i];
  }
  return { frame: [x, ...cols], held };
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
  /**
   * Per-series, per-frame-index measurement time (seconds) for points that
   * were forward-filled rather than measured; null where the point is a
   * real sample. Kept in a ref because it is rebuilt with every frame and
   * only read inside uPlot's cursor hook.
   */
  const heldRef = useRef<(number | null)[][]>([]);
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

  /**
   * What binning is in effect right now, or null when every tick has its
   * own point. Derived from the measured box so the caption tracks
   * resizes; buildFrame uses the same target formula.
   */
  const binning = useMemo(() => {
    const width = Math.max(200, boxSize.w || 600);
    const target = Math.max(40, Math.floor(width / 6));
    if (ticks.length <= target) return null;
    const spanMs = ticks[ticks.length - 1].t - ticks[0].t;
    const perBucketS = spanMs / target / 1000;
    const label =
      perBucketS >= 60
        ? `${Math.round(perBucketS / 60)} min/pt`
        : `${perBucketS >= 10 ? Math.round(perBucketS) : perBucketS.toFixed(1)} s/pt`;
    return { label, modes: [...new Set(series.map(binModeOf))].sort() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticks, boxSize.w, seriesKey]);


  const sample = (s: ChartSeriesDef, t: Tick): number | null => {
    const v = s.source === 'gauges' ? t.gauges[s.key] : t.derived[s.key];
    if (v === undefined || v === null || !Number.isFinite(v)) return null;
    return v * (s.scale ?? 1);
  };

  /**
   * Same fill, but also carrying WHEN each value was measured. A held
   * point is visually identical to a measured one — a cache hit rate from
   * one prompt an hour ago draws the same flat line as continuous
   * activity — so the tooltip needs to be able to say how old it is.
   * Entry is null where the point is a genuine measurement at that x.
   */
  const forwardFillWithAge = (
    col: (number | null)[],
    times: number[],
  ): { col: (number | null)[]; heldFrom: (number | null)[] } => {
    let last: number | null = null;
    let lastT: number | null = null;
    const out: (number | null)[] = [];
    const heldFrom: (number | null)[] = [];
    for (let i = 0; i < col.length; i++) {
      const v = col[i];
      if (v !== null) {
        last = v;
        lastT = times[i];
        out.push(v);
        heldFrom.push(null);
      } else {
        out.push(last);
        heldFrom.push(last === null ? null : lastT);
      }
    }
    return { col: out, heldFrom };
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
   * Build the uPlot frame, plus the parallel "when was this measured"
   * columns the tooltip uses to disclose held points.
   *
   * Sparse: exact ticks (step expansion where needed).
   * Dense (more ticks than ~5-6px buckets): one point per bucket, chosen
   * by each series' bin mode — 'peak' keeps the largest sample so bursts
   * and request spikes survive, 'last' keeps the final sample, which is
   * what a held ratio means. fill series then forward-fill empty buckets
   * so their line stays joined (a null bucket is a line break in uPlot).
   * Without binning, 15 min of 2 s ticks would be sub-pixel bars/points.
   */
  const binTarget = (width: number): number => Math.max(40, Math.floor(width / 6));

  const buildFrame = (): {
    frame: [number[], ...(number | null)[][]];
    held: (number | null)[][];
  } => {
    const box = boxRef.current;
    const width = box ? Math.max(200, box.clientWidth) : 600;
    const target = binTarget(width);

    if (ticks.length > target) {
      const t0 = ticks[0].t / 1000;
      const t1 = ticks[ticks.length - 1].t / 1000;
      const span = Math.max(1e-9, t1 - t0);
      const x: number[] = [];
      const cols: (number | null)[][] = series.map(() => []);
      // measurement time of each bucket's value, in seconds (null until a
      // bucket is filled from a neighbour rather than its own sample)
      const srcT: (number | null)[][] = series.map(() => []);
      let bi = -1;
      for (let i = 0; i < ticks.length; i++) {
        const b = Math.min(target - 1, Math.floor(((ticks[i].t / 1000 - t0) / span) * target));
        if (b !== bi) {
          bi = b;
          x.push(t0 + ((b + 0.5) / target) * span); // bucket center
          cols.forEach((col) => col.push(null));
          srcT.forEach((col) => col.push(null));
        }
        series.forEach((s, si) => {
          const v = sample(s, ticks[i]);
          if (v === null) return;
          const last = cols[si].length - 1;
          const cell = cols[si][last];
          if (binModeOf(s) === 'peak') {
            if (cell === null || v > (cell as number)) {
              cols[si][last] = v;
              srcT[si][last] = ticks[i].t / 1000;
            }
          } else {
            cols[si][last] = v;
            srcT[si][last] = ticks[i].t / 1000;
          }
        });
      }
      // hold the last measured value across buckets that had no sample at
      // all (same semantics as the sparse path): without this a fill series
      // breaks its line at every empty bucket — idle stretches between
      // prompts read as gaps in the chart
      const held: (number | null)[][] = series.map(() => []);
      for (let si = 0; si < series.length; si++) {
        if (series[si].fill === 'prev') {
          const filled = forwardFillWithAge(cols[si], srcT[si].map((t, i) => t ?? x[i]));
          cols[si] = filled.col;
          held[si] = filled.heldFrom;
        } else {
          held[si] = cols[si].map(() => null);
        }
      }
      return { frame: [x, ...cols], held };
    }

    const anyStep = series.some((s) => s.step);
    const rawX = ticks.map((t) => t.t / 1000);
    const build = (holdFlags: boolean[]) => {
      const cols: (number | null)[][] = [];
      const held: (number | null)[][] = [];
      series.forEach((s, si) => {
        const raw = ticks.map((t) => sample(s, t));
        if (holdFlags[si]) {
          const filled = forwardFillWithAge(raw, rawX);
          cols.push(filled.col);
          held.push(filled.heldFrom);
        } else {
          cols.push(raw);
          held.push(raw.map(() => null));
        }
      });
      return { cols, held };
    };

    // a bar series never needs step expansion (bars ARE the samples);
    // when it shares the frame with a step series, forward-fill the step
    // values instead of duplicating x (keeps the frame lengths aligned)
    if (series.some((s) => s.bars)) {
      const { cols, held } = build(series.map((s) => !!s.step || s.fill === 'prev'));
      return { frame: [rawX, ...cols], held };
    }
    const { cols, held } = build(series.map((s) => s.fill === 'prev'));
    return anyStep
      ? expandSteps(rawX, cols, series.map((s) => !!s.step), held)
      : { frame: [rawX, ...cols], held };
  };

  // uPlot only ever receives the value columns
  const buildData = (): [number[], ...(number | null)[][]] => {
    const built = buildFrame();
    heldRef.current = built.held;
    return built.frame;
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
              // a forward-filled point looks exactly like a measured one;
              // say when it was actually measured instead of implying the
              // server reported this value at the hovered time
              const heldFrom = heldRef.current[si - 1]?.[i] ?? null;
              const heldNote =
                heldFrom != null
                  ? ` <span class="chart-tip-held">held from ${new Date(
                      heldFrom * 1000,
                    ).toLocaleTimeString('en-GB', { hour12: false })}</span>`
                  : '';
              rows +=
                `<div class="chart-tip-row"><span class="chart-tip-dot" style="background:${color}"></span>` +
                `<span class="chart-tip-label">${u.series[si].label}</span><b>${formatValue(v as number)}</b>${heldNote}</div>`;
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
        {binning && (
          <span
            className="chart-binned"
            title={
              `More samples than pixels: each point covers ${binning.label} of ticks. ` +
              (binning.modes.includes('peak')
                ? 'Series marked peak show the largest sample in that span, not an average. '
                : '') +
              'Narrow the chart window to see individual samples.'
            }
          >
            binned · {binning.label} · {binning.modes.join(' + ')}
          </span>
        )}
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
