// @vitest-environment jsdom
/**
 * The server-reported throughput chips (llamacpp:prompt_tokens_seconds /
 * predicted_tokens_seconds). These gauges were collected and persisted but
 * never displayed; they are the only server-TIMED rates available.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WIDGETS } from '../registry';
import { GAUGES } from '../../lib/metrics';
import type { DashboardState } from '../../lib/dashboard';

const state = (over: Partial<DashboardState>): DashboardState =>
  ({
    status: 'ok', baseUrl: 'http://s', lastError: null, lastOkAt: 1, lastFailAt: null,
    failStreak: 0, gauges: {}, counters: {}, specPerPos: null, lastTick: null,
    models: null, slots: null, health: null, slotsStale: false, modelsStale: false,
    ...over,
  }) as DashboardState;

const mockDash = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../lib/dashboard', async (orig) => ({
  ...(await orig<typeof import('../../lib/dashboard')>()),
  useDashboard: () => mockDash.current,
}));
vi.mock('../../hooks/useTicks', () => ({ useTicks: () => [] }));

afterEach(cleanup);

const renderWidget = (id: string) => {
  const Body = WIDGETS[id].render;
  return render(<Body ticks={[]} />);
};

describe('server-reported rate chips', () => {
  it('shows the prompt gauge as the server\'s own measurement', () => {
    mockDash.current = state({ gauges: { [GAUGES.promptTokS]: 1234.5 } });
    renderWidget('kpi:prompt-tok-s');
    expect(screen.getByText(/server 1\.23k tok\/s/)).toBeTruthy();
  });

  it('labels the generation gauge as decode steps when a slot is speculative', () => {
    mockDash.current = state({
      gauges: { [GAUGES.predictedTokS]: 60 },
      slots: [{ id: 0, n_ctx: 8, speculative: true, is_processing: true }],
    });
    renderWidget('kpi:predicted-tok-s');
    expect(screen.getByText(/server 60\.00 steps\/s/)).toBeTruthy();
  });

  it('says tok/s when no slot is speculative', () => {
    mockDash.current = state({
      gauges: { [GAUGES.predictedTokS]: 60 },
      slots: [{ id: 0, n_ctx: 8, speculative: false, is_processing: true }],
    });
    renderWidget('kpi:predicted-tok-s');
    expect(screen.getByText(/server 60\.00 tok\/s/)).toBeTruthy();
  });

  it('hides the chip when the server reports 0 (nothing finished in the window)', () => {
    mockDash.current = state({ gauges: { [GAUGES.promptTokS]: 0 } });
    renderWidget('kpi:prompt-tok-s');
    expect(screen.queryByText(/server /)).toBeNull();
  });

  it('hides the chip when the gauge is absent entirely', () => {
    mockDash.current = state({ gauges: {} });
    renderWidget('kpi:prompt-tok-s');
    expect(screen.queryByText(/server /)).toBeNull();
  });
});
