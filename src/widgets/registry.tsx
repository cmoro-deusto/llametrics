/**
 * Widget registry: id -> {meta, render}. App renders settings.widgetOrder
 * through this map inside a sortable DnD grid.
 */
import type { ReactNode } from 'react';
import { useDashboard } from '../lib/dashboard';
import { useTicks } from '../hooks/useTicks';
import { COUNTERS, GAUGES, computeSinceStart, rollingRate } from '../lib/metrics';
import { normalizeBaseUrl } from '../lib/api';
import { useSettings, type Settings } from '../lib/settings';
import type { Tick } from '../lib/history';

/** headline throughput KPIs smooth over the last minute */
const ROLLING_MS = 60_000;
import { KpiCard } from './KpiCard';
import { TrendChart, type ChartSeriesDef } from './TrendChart';
import { ModelsCard } from './ModelsCard';
import { SlotsCard } from './SlotsCard';
import { CountersCard } from './CountersCard';

// module-level constants: TrendChart's effect deps include the series
// identity — inline arrays would recreate the uPlot instance on every tick
const TOK_S_SERIES: ChartSeriesDef[] = [
  // live per-poll rates from /slots diffs — these move while a task runs;
  // the /metrics gauges only spike when a task ENDS. Mixed magnitudes
  // (80 tok/s gen vs ~1200 tok/s prefill) get separate y-axes so neither
  // series squashes the other.
  // thin bars instead of a line: idle gaps read as empty space (no
  // connector diagonals) and short bursts stay visible
  { key: 'liveGenTokS', label: 'generation (live)', colorVar: 'chart-1', source: 'derived', bars: true },
  {
    key: 'promptPrefillTokS',
    label: 'prompt (prefill)',
    colorVar: 'chart-2',
    source: 'derived',
    step: true,
    // holds the last completed prompt's speed across idle gaps (like the KPI)
    fill: 'prev',
    yScale: 'y2',
  },
];
const REQUESTS_SERIES: ChartSeriesDef[] = [
  { key: GAUGES.requestsProcessing, label: 'processing', colorVar: 'chart-3', source: 'gauges', step: true },
  { key: GAUGES.requestsDeferred, label: 'deferred', colorVar: 'chart-4', source: 'gauges', step: true },
];
const CACHE_SERIES: ChartSeriesDef[] = [
  // 0..1 ratio plotted as a percentage; holds the last measured rate
  // across idle gaps (a prompt only produces a new value when it ends)
  { key: 'cacheHitRate', label: 'hit rate (%)', colorVar: 'chart-1', source: 'derived', step: true, scale: 100, fill: 'prev' },
];
const SPEC_SERIES: ChartSeriesDef[] = [
  { key: 'specAcceptRate', label: 'accept rate (%)', colorVar: 'chart-3', source: 'derived', step: true, scale: 100, fill: 'prev' },
];

export interface WidgetMeta {
  title: string;
  /** default size in grid units (12 columns, fixed-height rows) */
  w: number;
  h: number;
}

export interface WidgetRenderProps {
  ticks: Tick[];
}

export const WIDGETS: Record<string, { meta: WidgetMeta; render: (props: WidgetRenderProps) => ReactNode }> = {
  'kpi:predicted-tok-s': {
    meta: { title: 'Generation throughput', w: 2, h: 2 },
    render: ({ ticks }) => {
      const dash = useDashboard();
      const fmt = useFmt();
      // live rate from /slots diffs (updates every poll while a task runs);
      // fall back to the 60s rolling counter rate when idle
      const t = dash.lastTick;
      const live = t?.derived.liveGenTokS ?? null;
      const useLive = !!t?.slots?.some((s) => s.processing) && live !== null;
      const value = useLive ? live : rollingRate(ticks, COUNTERS.tokensPredicted, ROLLING_MS);
      return (
        <KpiCard
          label="Generation throughput"
          value={value}
          unit="rate"
          fmt={fmt}
          sub={
            <span className="chip">{useLive ? 'live · from /slots' : '60s rolling'}</span>
          }
          note="collecting samples…"
        />
      );
    },
  },
  'kpi:prompt-tok-s': {
    meta: { title: 'Prompt throughput', w: 2, h: 2 },
    render: ({ ticks }) => {
      const dash = useDashboard();
      const fmt = useFmt();
      const t = dash.lastTick;
      const live = t?.derived.livePromptTokS ?? null;
      const useLive = !!t?.slots?.some((s) => s.processing) && live !== null;
      // Hold the real prefill speed of the most recent completed prompt
      // (Δtokens/Δprompt-seconds, uncached) until the next one arrives —
      // no 60s rolling average, which dilutes short prompt bursts across
      // idle time and reads far too low
      let held: number | null = null;
      if (!useLive) {
        for (let i = ticks.length - 1; i >= 0; i--) {
          const v = ticks[i].derived.promptPrefillTokS;
          // skip 0: a fully-cached prompt advances prompt_seconds without
          // non-cached tokens and would hold a meaningless 0.00 on the card
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
            held = v;
            break;
          }
        }
      }
      const value = useLive ? live : held;
      const chip = useLive ? 'live' : held !== null ? 'last completed prompt' : 'awaiting first prompt';
      return (
        <KpiCard
          label="Prompt throughput"
          value={value}
          unit="rate"
          fmt={fmt}
          sub={<span className="chip">{chip}</span>}
          note="no prompt has finished yet"
        />
      );
    },
  },
  'kpi:session-gen-tok-s': {
    meta: { title: 'Avg generation (since start)', w: 2, h: 2 },
    render: () => {
      const dash = useDashboard();
      const fmt = useFmt();
      // Was derived.genTokS = Δtokens_predicted / wall-clock poll interval.
      // tokens_predicted_total is only credited when a task ENDS, so on a
      // 2 s poll that read 0.00 through the whole generation and then
      // spiked to a fictional several-hundred tok/s on the single tick the
      // task completed. The honest number is the server's own lifetime
      // ratio: generated tokens / time actually spent generating.
      const since = dash.counters ? computeSinceStart(dash.counters) : null;
      return (
        <KpiCard
          label="Avg generation (since start)"
          value={since?.genTokS ?? null}
          unit="rate"
          fmt={fmt}
          sub={<span className="chip">generated tokens / generation time</span>}
          note="nothing generated yet"
        />
      );
    },
  },
  'kpi:cache-hit-rate': {
    meta: { title: 'Prompt cache hit rate', w: 2, h: 2 },
    render: () => {
      const dash = useDashboard();
      return (
        <KpiCard
          label="Prompt cache hit rate"
          value={dash.lastTick?.derived.cacheHitRate ?? null}
          unit="percent"
          fmt={useFmt()}
          sub={<span className="chip">cached / total prompt tokens</span>}
          note="needs prompt activity"
        />
      );
    },
  },
  'kpi:spec-accept-rate': {
    meta: { title: 'Speculative accept rate', w: 2, h: 2 },
    render: () => {
      const dash = useDashboard();
      const d = dash.lastTick?.derived;
      return (
        <KpiCard
          label="Speculative accept rate"
          value={d?.specAcceptRate ?? null}
          unit="percent"
          fmt={useFmt()}
          sub={
            d?.specTokensPerVerif != null ? (
              <span className="chip">{d.specTokensPerVerif.toFixed(2)} tok/step</span>
            ) : undefined
          }
          note="spec decode inactive"
        />
      );
    },
  },
  'kpi:requests-processing': {
    meta: { title: 'Requests in flight', w: 2, h: 2 },
    render: () => (
      <KpiCard
        label="Requests in flight"
        value={useGauge(GAUGES.requestsProcessing)}
        unit="count"
        fmt={useFmt()}
      />
    ),
  },
  'kpi:requests-deferred': {
    meta: { title: 'Requests deferred', w: 2, h: 2 },
    render: () => (
      <KpiCard
        label="Requests deferred"
        value={useGauge(GAUGES.requestsDeferred)}
        unit="count"
        fmt={useFmt()}
      />
    ),
  },

  'chart:tok-s': {
    meta: { title: 'Throughput (tok/s)', w: 6, h: 4 },
    render: ({ ticks }) => (
      <TrendChart ticks={ticks} series={TOK_S_SERIES} unit="rate" />
    ),
  },
  'chart:requests': {
    meta: { title: 'Requests', w: 6, h: 3 },
    render: ({ ticks }) => <TrendChart ticks={ticks} series={REQUESTS_SERIES} />,
  },
  'chart:cache-hit-rate': {
    meta: { title: 'Prompt cache hit rate', w: 6, h: 3 },
    render: ({ ticks }) => (
      <TrendChart ticks={ticks} series={CACHE_SERIES} unit="percent" />
    ),
  },
  'chart:spec-accept-rate': {
    meta: { title: 'Speculative accept rate', w: 6, h: 3 },
    render: ({ ticks }) => (
      <TrendChart ticks={ticks} series={SPEC_SERIES} unit="percent" />
    ),
  },
  // NOTE: the id keeps its 'chart:' prefix so existing saved layouts and
  // widgetOrder entries keep resolving — it is a KPI tile now.
  'chart:busy-slots': {
    meta: { title: 'Avg busy slots per decode', w: 2, h: 2 },
    render: () => {
      // llamacpp:n_busy_slots_per_decode = n_busy_slots / n_decode, and
      // upstream accumulates BOTH since server start (server-task.cpp).
      // Plotted on a time axis it read as live concurrency while actually
      // being a lifetime mean that flattens out after a few hours of
      // uptime. Shown as a single since-start number instead.
      const value = useGauge(GAUGES.busySlotsPerDecode);
      return (
        <KpiCard
          label="Avg busy slots per decode"
          value={value}
          unit="num"
          fmt={useFmt()}
          sub={<span className="chip">since server start</span>}
          note="no decode has run yet"
        />
      );
    },
  },

  models: {
    meta: { title: 'Models', w: 4, h: 4 },
    render: () => {
      const dash = useDashboard();
      return <ModelsCard models={dash.models} fmt={useFmt()} />;
    },
  },
  slots: {
    meta: { title: 'Slots', w: 4, h: 4 },
    render: () => {
      const dash = useDashboard();
      return <SlotsCard slots={dash.slots} fmt={useFmt()} />;
    },
  },
  counters: {
    meta: { title: 'Counters (since server start)', w: 12, h: 3 },
    render: () => {
      const dash = useDashboard();
      return <CountersCard counters={dash.counters ?? null} specPerPos={dash.specPerPos} fmt={useFmt()} />;
    },
  },
};

// ---- small hooks used inside registry render fns ----
// Each `render` entry is a real React component (rendered as <Render />),
// so hook calls inside it belong to that component instance.

function useFmt(): Settings['numberFormat'] {
  const s = useSettings();
  return s.numberFormat;
}

function useGauge(key: string): number | undefined {
  const dash = useDashboard();
  return dash.gauges?.[key];
}

/** Resolve the active server key (empty string when unconfigured). */
export function activeServerKey(settings: Settings): string {
  return normalizeBaseUrl(settings.baseUrl);
}

export function useActiveTicks(settings: Settings): Tick[] {
  return useTicks(activeServerKey(settings), settings.chartWindowMin);
}
