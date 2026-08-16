// @vitest-environment jsdom
/**
 * Chart data-path test: captures what uPlot actually receives.
 * Proves (or disproves) that registry → TrendChart → uPlot data
 * construction works with realistic ticks, including step expansion
 * and the live-derived series.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// capture uPlot construction instead of drawing
const { constructions, FakeUPlot } = vi.hoisted(() => {
  const constructions: { options: Record<string, unknown>; data: (number | null)[][] }[] = [];
  class FakeUPlot {
    opts: Record<string, unknown>;
    data: (number | null)[][];
    constructor(opts: Record<string, unknown>, data: (number | null)[][]) {
      this.opts = opts;
      this.data = data;
      constructions.push({ options: opts, data });
    }
    // mirror the real uPlot class extension (bar path renderer)
    static paths = {
      bars: () => () => null,
    };
    setSize() {}
    setData(d: (number | null)[][]) {
      this.data = d;
    }
    redraw() {}
    destroy() {}
  }
  return { constructions, FakeUPlot };
});
vi.mock('uplot', () => ({ default: FakeUPlot }));

import { TrendChart, nearestXIndex } from '../TrendChart';
import { WIDGETS } from '../registry';
import type { Tick } from '../../lib/history';

function makeTicks(n: number, startT = Date.now() - n * 2000): Tick[] {
  const ticks: Tick[] = [];
  let gen = 0;
  let prompt = 0;
  for (let i = 0; i < n; i++) {
    gen += 100; // 100 gen tokens per 2s interval while "active"
    prompt += i % 3 === 0 ? 20 : 0;
    ticks.push({
      serverKey: 'http://10.0.0.57:9080',
      t: startT + i * 2000,
      gauges: {
        predicted_tokens_seconds: 50 + (i % 5),
        prompt_tokens_seconds: i % 3 === 0 ? 10 : 0,
        requests_processing: i % 4 === 0 ? 1 : 0,
        requests_deferred: 0,
        n_busy_slots_per_decode: 1,
      },
      counters: {
        prompt_tokens_total: prompt,
        prompt_tokens_cached_total: 0,
        tokens_predicted_total: gen,
        tokens_predicted_seconds_total: gen / 50,
        n_decode_total: i,
        n_tokens_max: 1000,
        spec_decode_num_draft_tokens_total: 0,
        spec_decode_num_accepted_tokens_total: 0,
        spec_decode_num_drafts_total: 0,
      },
      derived: {
        genTokS: 50,
        promptTokS: i % 3 === 0 ? 10 : 0,
        cacheHitRate: null,
        specAcceptRate: null,
        specTokensPerVerif: null,
        liveGenTokS: i > 0 ? 50.5 : null,
        livePromptTokS: i % 3 === 0 ? 10 : null,
      },
      slots: [
        {
          id: 0,
          processing: true,
          nDecoded: gen,
          nPromptProcessed: prompt,
        },
      ],
    });
  }
  return ticks;
}

afterEach(() => {
  constructions.length = 0;
});

describe('nearestXIndex', () => {
  it('finds the nearest value in a non-decreasing column (duplicates allowed)', () => {
    const x = [1, 2, 2, 3, 5];
    expect(nearestXIndex(x, 0.4)).toBe(0);
    expect(nearestXIndex(x, 2.4)).toBe(2);
    expect(nearestXIndex(x, 2.6)).toBe(3);
    expect(nearestXIndex(x, 99)).toBe(4);
    expect(nearestXIndex([7], 100)).toBe(0);
  });
});

describe('chart data path', () => {
  it('TrendChart passes non-null line data to uPlot', () => {
    const ticks = makeTicks(10);
    render(
      <TrendChart
        ticks={ticks}
        series={[
          { key: 'predicted_tokens_seconds', label: 'gen', colorVar: 'chart-1', source: 'gauges' },
        ]}
      />,
    );
    expect(constructions).toHaveLength(1);
    const data = constructions[0].data;
    expect(data[0]).toHaveLength(10); // x column
    const nonNull = data[1].filter((v) => v !== null).length;
    expect(nonNull).toBe(10);
  });

  it('step expansion keeps the line visible for constant series', () => {
    const ticks = makeTicks(5);
    render(
      <TrendChart
        ticks={ticks}
        series={[
          { key: 'requests_processing', label: 'processing', colorVar: 'chart-3', source: 'gauges', step: true },
          { key: 'requests_deferred', label: 'deferred', colorVar: 'chart-4', source: 'gauges', step: true },
        ]}
      />,
    );
    expect(constructions).toHaveLength(1);
    const data = constructions[0].data;
    // step-after: first point + 2 points per subsequent tick
    expect(data[0].length).toBe(1 + (5 - 1) * 2);
    // x must be non-decreasing
    for (let i = 1; i < data[0].length; i++) {
      expect(data[0][i] as number).toBeGreaterThanOrEqual(data[0][i - 1] as number);
    }
    // series 0 has a mix of 0/1 (i%4===0), series 1 is constant 0 — both non-null
    expect(data[1].every((v) => v === 0 || v === 1)).toBe(true);
    expect(data[2].every((v) => v === 0)).toBe(true);
  });

  it('registry chart widgets feed real ticks through the props object', () => {
    const ticks = makeTicks(8);
    const Render = WIDGETS['chart:tok-s'].render as (p: { ticks: Tick[] }) => React.ReactNode;
    render(<>{Render({ ticks })}</>);
    expect(constructions).toHaveLength(1);
    const data = constructions[0].data;
    // bar + step series share the frame without x duplication:
    // one x point per tick, step series forward-filled
    expect(data[0]).toHaveLength(8);
    expect(data[1].filter((v) => v !== null).length).toBe(7);
    expect(data[2].every((v) => v === null)).toBe(true); // no prefill in fixture ticks
  });

  it('scale + forward-fill: 0..1 ratios plot as 0–100% and hold across idle gaps', () => {
    const ticks = makeTicks(4).map((t, i) => ({
      ...t,
      derived: { ...t.derived, cacheHitRate: i === 0 || i === 3 ? (i === 0 ? 0.99 : 0.5) : null },
    }));
    render(
      <TrendChart
        ticks={ticks}
        series={[
          { key: 'cacheHitRate', label: 'hit rate (%)', colorVar: 'chart-1', source: 'derived', step: true, scale: 100, fill: 'prev' },
        ]}
      />,
    );
    expect(constructions).toHaveLength(1);
    const data = constructions[0].data;
    // filled column: [0.99, 0.99, 0.99, 0.5] → ×100, expanded for step
    expect(data[1]).toEqual([99, 99, 99, 99, 99, 99, 50]);
  });

  it('yScale series get a dedicated independent right-hand axis', () => {
    const ticks = makeTicks(4);
    render(
      <TrendChart
        ticks={ticks}
        series={[
          { key: 'genTokS', label: 'gen', colorVar: 'chart-1', source: 'derived' },
          { key: 'promptPrefillTokS', label: 'prefill', colorVar: 'chart-2', source: 'derived', yScale: 'y2' },
        ]}
      />,
    );
    expect(constructions).toHaveLength(1);
    const opts = constructions[0].options as unknown as {
      scales: Record<string, unknown>;
      axes: { scale?: string }[];
      series: { label: string; scale?: string }[];
    };
    expect(opts.scales.y2).toBeDefined();
    expect(opts.axes.some((a) => a.scale === 'y2')).toBe(true);
    expect(opts.series.find((s) => s.label === 'prefill')?.scale).toBe('y2');
    expect(opts.series.find((s) => s.label === 'gen')?.scale).toBeUndefined();
  });

  it('bar series use the built-in bar renderer without a line', () => {
    const ticks = makeTicks(4);
    render(
      <TrendChart
        ticks={ticks}
        series={[
          { key: 'liveGenTokS', label: 'gen', colorVar: 'chart-1', source: 'derived', bars: true },
        ]}
      />,
    );
    const opts = constructions[0].options as unknown as {
      series: { label: string; width: number; stroke: unknown; fill: string; paths: unknown }[];
    };
    const gen = opts.series.find((s) => s.label === 'gen');
    expect(gen?.paths).toBeTypeOf('function');
    expect(gen?.width).toBe(0); // no outline
    expect(gen?.stroke).toBeUndefined();
    // jsdom can't resolve CSS vars, so the fill color is empty here —
    // assert the bar wiring, not the color
    expect(typeof gen?.fill).toBe('string');
  });

  it('dense data is binned to ~5-6px buckets, spikes survive in bars', () => {
    const ticks = makeTicks(100).map((t, i) => ({
      ...t,
      // ~20% duty: most buckets are empty
      derived: { ...t.derived, liveGenTokS: i === 50 ? 999 : i % 5 === 0 ? 50 : null },
    }));
    render(
      <TrendChart
        ticks={ticks}
        series={[
          { key: 'liveGenTokS', label: 'gen', colorVar: 'chart-1', source: 'derived', bars: true },
        ]}
      />,
    );
    const data = constructions[0].data;
    // jsdom width 200 → target ~40 buckets, not 100 raw ticks
    expect(data[0].length).toBeLessThanOrEqual(40);
    expect(data[0].length).toBeGreaterThanOrEqual(30);
    expect(Math.max(...data[1].map((v) => v ?? 0))).toBe(999); // spike preserved
    expect(data[1].some((v) => v === null)).toBe(true); // idle buckets stay empty
  });

  it('mixed step + non-step series share one expanded x frame', () => {
    const ticks = makeTicks(4).map((t, i) => ({
      ...t,
      derived: { ...t.derived, promptPrefillTokS: i >= 2 ? 1200 : null },
    }));
    render(
      <TrendChart
        ticks={ticks}
        series={[
          { key: 'genTokS', label: 'gen', colorVar: 'chart-1', source: 'derived' },
          { key: 'promptPrefillTokS', label: 'prefill', colorVar: 'chart-2', source: 'derived', step: true },
        ]}
      />,
    );
    expect(constructions).toHaveLength(1);
    const data = constructions[0].data;
    expect(data[0]).toHaveLength(1 + 3 * 2); // tick 0 (gen only) + 3 expanded ticks
    // non-step series: one vertex per tick, null at the hold slots
    expect(data[1].filter((v) => v !== null)).toEqual([50, 50, 50, 50]);
    // step series: appears at tick 2, holds its value into tick 3
    expect(data[2]).toEqual([null, null, null, null, 1200, 1200, 1200]);
  });

  it('empty ticks show the "no data yet" empty state instead of a blank canvas', () => {
    render(
      <TrendChart
        ticks={[]}
        series={[{ key: 'liveGenTokS', label: 'live', colorVar: 'chart-1', source: 'derived' }]}
      />,
    );
    expect(constructions).toHaveLength(0);
    expect(screen.getByText('no data collected yet')).toBeTruthy();
  });

  it('all-null series (idle server) show the "no values in window" empty state', () => {
    const ticks = makeTicks(4).map((t) => ({
      ...t,
      derived: { ...t.derived, liveGenTokS: null },
    }));
    render(
      <TrendChart
        ticks={ticks}
        series={[{ key: 'liveGenTokS', label: 'live', colorVar: 'chart-1', source: 'derived' }]}
      />,
    );
    expect(constructions).toHaveLength(0);
    expect(screen.getByText('no values in this window')).toBeTruthy();
  });
});
