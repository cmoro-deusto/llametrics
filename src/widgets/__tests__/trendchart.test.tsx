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

import { TrendChart } from '../TrendChart';
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
    expect(data[0]).toHaveLength(8);
    const live = data[1].filter((v) => v !== null).length;
    expect(live).toBe(7); // first tick has no live rate (needs a previous sample)
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
