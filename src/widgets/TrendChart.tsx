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
   * Build the uPlot frame. For long windows, thin to ~2x pixel width while
   * keeping every bucket's min and max index per series so spikes survive.
   */
  const buildData = (): [number[], ...(number | null)[][]] => {
    const anyStep = series.some((s) => s.step);
    const rawX = ticks.map((t) => t.t / 1000);
    const rawCols = series.map((s) => {
      const col = ticks.map((t) => sample(s, t));
      if (s.fill === 'prev') {
        let last: number | null = null;
        for (let i = 0; i < col.length; i++) {
          if (col[i] !== null) last = col[i];
          else col[i] = last; // leading nulls (no data yet) stay null
        }
      }
      return col;
    });
    let data: [number[], ...(number | null)[][]] = anyStep
      ? expandSteps(rawX, rawCols, series.map((s) => !!s.step))
      : [rawX, ...rawCols];

    const box = boxRef.current;
    const width = box ? Math.max(200, box.clientWidth) : 600;
    if (data[0].length <= width * 2) return data;

    const n = data[0].length;
    const bucket = Math.ceil(n / (width * 2));
    const keep = new Set<number>();
    for (let start = 0; start < n; start += bucket) {
      const end = Math.min(n, start + bucket);
      keep.add(start);
      keep.add(end - 1);
      for (let ci = 1; ci < data.length; ci++) {
        const col = data[ci];
        let minI = -1, maxI = -1, minV = Infinity, maxV = -Infinity;
        for (let i = start; i < end; i++) {
          const v = col[i];
          if (v === null) continue;
          if (v < minV) { minV = v; minI = i; }
          if (v > maxV) { maxV = v; maxI = i; }
        }
        if (minI >= 0) keep.add(minI);
        if (maxI >= 0) keep.add(maxI);
      }
    }
    const idx = [...keep].sort((a, b) => a - b);
    return [idx.map((i) => data[0][i]), ...data.slice(1).map((col) => idx.map((i) => col[i]))];
  };

  // instance (re)creation: only when the series layout, size, theme or
  // data-emptiness changes — ticks updates go through setData() below
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const gridColor = colors['--chart-grid'];
    const muted = colors['--text-muted'];
    const borderColor = colors['--border'];

    const buildOptions = (width: number, height: number): uPlot.Options => ({
      width,
      height,
      series: [
        { label: '' },
        ...series.map((s) => ({
          label: s.label,
          stroke: colors[`--${s.colorVar}`],
          fill: withAlpha(colors[`--${s.colorVar}`], 0.07),
          width: 2,
        })),
      ],
      scales: {
        x: { time: true },
        // NOTE: uPlot has no min/max scale options — an explicit min there
        // disables auto-ranging of max and silently maps every point to
        // NaN (invisible series). A range fn is the supported way to pin
        // the floor at zero while keeping the top auto.
        y: {
          auto: true,
          range: (_u, dataMin, dataMax): [number, number] => {
            if (dataMin == null || dataMax == null) return [0, 1];
            const min = Math.min(0, dataMin);
            let max = Math.max(0, dataMax);
            if (max <= min) max = min + 1;
            return [min, max * 1.05];
          },
        },
      },
      axes: [
        {
          stroke: muted,
          grid: { stroke: gridColor, width: 1 },
          font: '11px ui-sans-serif, system-ui, sans-serif',
          scale: 'x',
        },
        {
          stroke: borderColor,
          grid: { stroke: gridColor, width: 1 },
          font: '11px ui-sans-serif, system-ui, sans-serif',
          scale: 'y',
        },
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
            if (left == null || top == null || xCol.length === 0) {
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

    return () => {
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
