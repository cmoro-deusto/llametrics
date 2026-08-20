// @vitest-environment jsdom
/**
 * Top bar: connection state and data age.
 *
 * The dashboard keeps every panel populated while a server is away, so the
 * only thing distinguishing live data from a frozen screen is this bar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { TopBar } from '../TopBar';
import { settingsStore } from '../../lib/settings';
import type { DashboardState } from '../../lib/dashboard';

const mockDash = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../lib/dashboard', async (orig) => ({
  ...(await orig<typeof import('../../lib/dashboard')>()),
  useDashboard: () => mockDash.current,
  refreshDashboardSettings: () => undefined,
}));

const NOW = new Date('2026-08-20T12:00:00Z').getTime();

const state = (over: Partial<DashboardState>): DashboardState =>
  ({
    status: 'ok', baseUrl: 'http://s', lastError: null, lastOkAt: NOW, lastFailAt: null,
    failStreak: 0, gauges: {}, counters: {}, specPerPos: null, lastTick: null,
    models: null, slots: null, health: null, slotsStale: false, modelsStale: false,
    ...over,
  }) as DashboardState;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  settingsStore.set({ baseUrl: 'http://s', pollMs: 2000 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TopBar connection state', () => {
  it('says the model is loading rather than reporting a dead server', () => {
    // llama-server 503s every endpoint while loading, so /metrics fails and
    // the metrics-derived status is 'down' — health knows better
    mockDash.current = state({
      status: 'down',
      lastError: '/metrics returned HTTP 503',
      health: { state: 'loading', message: 'Loading model', httpStatus: 503 },
    });
    render(<TopBar onOpenSettings={() => {}} />);
    expect(screen.getByText('loading model…')).toBeTruthy();
    expect(screen.queryByText('unreachable')).toBeNull();
  });

  it('keeps the server error message when health reports a real failure', () => {
    mockDash.current = state({
      status: 'stale',
      health: { state: 'error', message: 'no slot available', httpStatus: 500 },
    });
    render(<TopBar onOpenSettings={() => {}} />);
    expect(screen.getByText(/server error: no slot available/)).toBeTruthy();
  });

  it('reports live when everything is fine', () => {
    mockDash.current = state({ health: { state: 'ok', message: null, httpStatus: 200 } });
    render(<TopBar onOpenSettings={() => {}} />);
    expect(screen.getByText('live')).toBeTruthy();
  });
});

describe('TopBar data age', () => {
  it('stays quiet while data is fresh', () => {
    mockDash.current = state({ lastOkAt: NOW - 2000 });
    render(<TopBar onOpenSettings={() => {}} />);
    expect(screen.queryByText(/data .* old/)).toBeNull();
  });

  it('reports the age once the data falls behind the poll cadence', () => {
    mockDash.current = state({ status: 'stale', lastOkAt: NOW - 125_000 });
    render(<TopBar onOpenSettings={() => {}} />);
    expect(screen.getByText(/data 2m 5s old/)).toBeTruthy();
  });

  it('keeps counting without a new poll', () => {
    mockDash.current = state({ status: 'stale', lastOkAt: NOW - 60_000 });
    render(<TopBar onOpenSettings={() => {}} />);
    expect(screen.getByText(/data 1m 0s old/)).toBeTruthy();
    // no dashboard update arrives; the readout must still advance
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText(/data 1m 30s old/)).toBeTruthy();
  });
});
