/**
 * Polling engine: fetches /metrics, /models, /slots, /health on every tick,
 * computes derived KPIs, persists ticks to IndexedDB, and exposes a
 * subscribable state for React (useSyncExternalStore).
 *
 * Resilience per spec:
 *  - on failure keep last data with 'stale' status, retry with exponential
 *    backoff 1s -> 30s, auto-recover;
 *  - pause polling while the tab is hidden;
 *  - counter resets (server restart) detected via negative deltas.
 */
import {
  buildModelCards,
  fetchHealth,
  fetchMetricsText,
  fetchModels,
  fetchSlots,
  normalizeBaseUrl,
  slotNextToken,
  type ModelCardData,
  type SlotInfo,
} from './api';
import { historyStore, type Tick } from './history';
import {
  COUNTERS,
  GAUGES,
  SPEC_PER_POS,
  computeDerived,
  liveSlotRate,
  type CounterMap,
  type SlotLiveSample,
} from './metrics';
import { indexMetrics, parseMetrics } from './prometheus';
import { settingsStore } from './settings';
import { useSyncExternalStore } from 'react';

export type ConnStatus = 'idle' | 'ok' | 'stale' | 'down';

export interface DashboardState {
  status: ConnStatus;
  baseUrl: string;
  lastError: string | null;
  lastOkAt: number | null;
  lastFailAt: number | null;
  /** consecutive failed metrics fetches (drives backoff) */
  failStreak: number;

  gauges: Record<string, number> | null;
  counters: Record<string, number> | null;
  specPerPos: { position: string; value: number }[] | null;
  /** latest tick persisted (or to be persisted) this cycle */
  lastTick: Tick | null;
  models: ModelCardData[] | null;
  slots: SlotInfo[] | null;
  healthOk: boolean | null;
}

const INITIAL: DashboardState = {
  status: 'idle',
  baseUrl: '',
  lastError: null,
  lastOkAt: null,
  lastFailAt: null,
  failStreak: 0,
  gauges: null,
  counters: null,
  specPerPos: null,
  lastTick: null,
  models: null,
  slots: null,
  healthOk: null,
};

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

class DashboardEngine {
  private state: DashboardState = INITIAL;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private inFlight = false;
  /** in-memory previous counters for delta math (seeded from history on start) */
  private prevCounters: CounterMap | null = null;
  /** in-memory previous live slot sample (seeded from history on start) */
  private prevSlots: SlotLiveSample[] | null = null;
  private prevT: number | null = null;

  // -- store plumbing ------------------------------------------------------

  // arrow fields: these are passed bare to useSyncExternalStore and must
  // keep `this` bound to the engine instance
  get = (): DashboardState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<DashboardState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // -- lifecycle -----------------------------------------------------------

  start(): void {
    this.stopping = false;
    this.applySettings();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    this.stopping = true;
    this.clearTimer();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.set({ ...INITIAL });
  }

  private appliedPollMs: number | null = null;

  /** Re-arm polling when settings (base URL / interval) change. */
  applySettings(): void {
    const s = settingsStore.get();
    const url = normalizeBaseUrl(s.baseUrl);
    const urlChanged = url !== this.state.baseUrl;
    const pollChanged = s.pollMs !== this.appliedPollMs;
    this.appliedPollMs = s.pollMs;
    if (url === '' || this.stopping) {
      this.set({ ...INITIAL, status: 'idle' });
      return;
    }
    if (!urlChanged && !pollChanged) return;
    this.clearTimer();
    if (urlChanged) {
      // new server: no in-memory prev; derived deltas seed from its history
      this.prevCounters = null;
      this.prevSlots = null;
      this.prevT = null;
      this.set({
        ...INITIAL,
        baseUrl: url,
        status: 'stale',
      });
    }
    if (urlChanged) {
      void this.tick();
    } else {
      // interval-only change: reschedule with the new cadence
      this.scheduleNext(s.pollMs);
    }
  }

  private onVisibility = (): void => {
    const s = settingsStore.get();
    if (document.hidden || s.baseUrl === '' || this.stopping) {
      this.clearTimer();
      return;
    }
    this.clearTimer();
    this.scheduleNext(settingsStore.get().pollMs);
    // refresh immediately on return to the tab
    void this.tick();
  };

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.clearTimer();
    if (document.hidden || this.stopping || settingsStore.get().baseUrl === '') return;
    this.timer = setTimeout(() => void this.tick(), Math.max(250, delayMs));
  }

  // -- the tick ------------------------------------------------------------

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    const url = normalizeBaseUrl(settingsStore.get().baseUrl);
    if (url === '') return;

    this.inFlight = true;
    try {
      const [metricsRes, modelsRes, slotsRes, healthRes] = await Promise.allSettled([
        fetchMetricsText(url),
        fetchModels(url),
        fetchSlots(url),
        fetchHealth(url),
      ]);

      const now = Date.now();

      // merge auxiliary results (independent of metrics success)
      const models = modelsRes.status === 'fulfilled' ? buildModelCards(modelsRes.value) : null;
      const slots = slotsRes.status === 'fulfilled' ? slotsRes.value : null;
      const healthOk =
        healthRes.status === 'fulfilled' ? healthRes.value.status === 'ok' : null;

      if (metricsRes.status === 'fulfilled') {
        const idx = indexMetrics(parseMetrics(metricsRes.value));
        const gauges: Record<string, number> = {};
        for (const g of Object.values(GAUGES)) {
          const v = idx.flat.get(g);
          if (v !== undefined && Number.isFinite(v)) gauges[g] = v;
        }
        const counters: Record<string, number> = {};
        for (const c of Object.values(COUNTERS)) {
          const v = idx.flat.get(c);
          if (v !== undefined && Number.isFinite(v)) counters[c] = v;
        }
        const specPerPos = (idx.labeled.get(SPEC_PER_POS) ?? []).map((s) => ({
          position: s.labels.position ?? '?',
          value: s.value,
        }));

        // live per-slot sample: the only "as it happens" throughput signal
        // (generation counters are only fed when a task ends)
        const curSlots: SlotLiveSample[] | null =
          slots !== null
            ? slots.map((s) => ({
                id: s.id,
                processing: !!s.is_processing,
                nDecoded: slotNextToken(s)?.n_decoded ?? 0,
                nPromptProcessed: s.n_prompt_tokens_processed ?? 0,
              }))
            : null;

        // derived KPIs from the previous sample; after a page reload the
        // previous sample is the newest tick in persisted history
        let prev = this.prevCounters;
        let prevS = this.prevSlots;
        let prevT = this.prevT;
        if (prev === null) {
          const lastTick = await historyStore.last(url).catch(() => null);
          prev = lastTick?.counters ?? null;
          prevS = lastTick?.slots ?? null;
          prevT = lastTick?.t ?? null;
        }
        let derived: Tick['derived'] = {
          genTokS: null,
          promptTokS: null,
          cacheHitRate: null,
          specAcceptRate: null,
          specTokensPerVerif: null,
          liveGenTokS: null,
          livePromptTokS: null,
        };
        if (prev && prevT !== null) {
          const dt = Math.max(0.25, (now - prevT) / 1000);
          const d = computeDerived(prev, counters, dt);
          derived = {
            genTokS: d.genTokS.value,
            promptTokS: d.promptTokS.value,
            cacheHitRate: d.cacheHitRate.value,
            specAcceptRate: d.specAcceptRate.value,
            specTokensPerVerif: d.specTokensPerVerif.value,
            liveGenTokS: liveSlotRate(prevS, curSlots, dt, 'nDecoded').rate,
            livePromptTokS: liveSlotRate(prevS, curSlots, dt, 'nPromptProcessed').rate,
          };
        }

        const tick: Tick = {
          serverKey: url,
          t: now,
          gauges,
          counters,
          derived,
          slots: curSlots ?? undefined,
        };
        this.prevCounters = counters;
        this.prevT = now;
        void historyStore.append(tick).catch(() => undefined);

        this.set({
          status: 'ok',
          baseUrl: url,
          lastError: null,
          lastOkAt: now,
          failStreak: 0,
          gauges,
          counters,
          specPerPos: specPerPos.length ? specPerPos : null,
          lastTick: tick,
          models: models ?? this.state.models,
          slots: slots ?? this.state.slots,
          healthOk: healthOk ?? this.state.healthOk,
        });
      } else {
        const err =
          metricsRes.status === 'rejected'
            ? metricsRes.reason instanceof Error
              ? metricsRes.reason.message
              : String(metricsRes.reason)
            : 'unknown error';
        const failStreak = this.state.failStreak + 1;
        this.set({
          status: this.state.lastOkAt !== null || this.state.gauges !== null ? 'stale' : 'down',
          lastError: err,
          lastFailAt: now,
          failStreak,
          models: models ?? this.state.models,
          slots: slots ?? this.state.slots,
          healthOk,
        });
      }
    } finally {
      this.inFlight = false;
    }

    // schedule the next attempt (backoff while failing)
    if (this.stopping || document.hidden) return;
    const delay =
      this.state.status === 'ok'
        ? settingsStore.get().pollMs
        : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.state.failStreak - 1));
    this.scheduleNext(delay);
  }
}

export const dashboard = new DashboardEngine();

export function useDashboard(): DashboardState {
  return useSyncExternalStore(dashboard.subscribe, dashboard.get, dashboard.get);
}

export function startDashboard(): void {
  dashboard.start();
}

/** re-apply current settings (call after any settings mutation that affects polling) */
export function refreshDashboardSettings(): void {
  dashboard.applySettings();
}
