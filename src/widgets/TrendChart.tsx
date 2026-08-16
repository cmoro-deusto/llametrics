/**
 * uPlot time-series chart over persisted ticks.
 * Re-creates the instance when colors (theme) or series change.
 */
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useEffect, useRef, useState } from 'react';
import type { Tick } from '../lib/history';
import { downsampleMinMax } from '../lib/metrics';
import { cssVar, useCssVars } from '../hooks/useCssVars';

export interface ChartSeriesDef {
  key: string;
  label: string;
  /** CSS custom property name (without --) providing the stroke color */
  colorVar: string;
  source: 'gauges' | 'derived';
  step?: boolean;
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
  height = 220,
}: {
  series: ChartSeriesDef[];
  ticks: Tick[];
  height?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const uRef = useRef<uPlot | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const colors = useCssVars(
    [...series.map((s) => `--${s.colorVar}`), '--chart-grid', '--text-muted', '--border'],
  );

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const gridColor = colors['--chart-grid'];
    const muted = colors['--text-muted'];
    const borderColor = colors['--border'];

    const sample = (s: ChartSeriesDef, t: Tick): number | null => {
      const v = s.source === 'gauges' ? t.gauges[s.key] : t.derived[s.key];
      return v === undefined || v === null || !Number.isFinite(v) ? null : v;
    };

    const buildData = (): [number[], ...(number | null)[][]] => {
      const allStep = series.every((s) => s.step);
      const rawX = ticks.map((t) => t.t / 1000);
      const rawCols = series.map((s) => ticks.map((t) => sample(s, t)));
      if (!allStep) return [rawX, ...rawCols];

      // step-after expansion: each value holds until the next sample time
      const x: number[] = [];
      const cols: (number | null)[][] = series.map(() => []);
      let prev: (number | null)[] | null = null;
      for (let i = 0; i < ticks.length; i++) {
        const cur = series.map((s) => sample(s, ticks[i]));
        const anyCur = cur.some((v) => v !== null);
        if (prev !== null && anyCur) {
          x.push(rawX[i]);
          cols.forEach((col, si) => col.push(cur[si] !== null ? prev![si] : null));
        }
        if (anyCur) {
          x.push(rawX[i]);
          cols.forEach((col, si) => col.push(cur[si]));
        }
        prev = cur;
      }
      return [x, ...cols];
    };

    const buildOptions = (width: number): uPlot.Options => ({
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
        y: { auto: true, min: 0 },
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
      cursor: { drag: { x: false, y: false } },
    });

    const width = Math.max(200, box.clientWidth);
    // downsample to ~2x pixel width so long windows stay fast
    let data = buildData();
    if (data[0].length > width * 2) {
      const ts = data[0];
      const idxs = [...new Set(
        downsampleMinMax(ts.map((t, i) => [t, i] as [number, number]), width).map(([, i]) => i),
      )].sort((a, b) => a - b);
      data = [idxs.map((i) => ts[i]), ...series.map((_, ci) => idxs.map((i) => data[ci + 1][i]))];
    }

    let u: uPlot;
    try {
      u = new uPlot(buildOptions(width), data, box);
    } catch (e) {
      setChartError((e as Error).message);
      return;
    }
    uRef.current = u;

    const ro = new ResizeObserver(() => {
      const w = Math.max(200, box.clientWidth);
      u.setSize({ width: w, height });
    });
    ro.observe(box);

    return () => {
      ro.disconnect();
      u.destroy();
      uRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, ticks, height, JSON.stringify(colors)]);

  if (chartError) {
    return <span className="muted">chart unavailable: {chartError}</span>;
  }

  return (
    <div>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span className="swatch" style={{ background: `var(--${s.colorVar})` }} />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={boxRef} className="chart-box" style={{ height }} />
    </div>
  );
}

export { cssVar };
