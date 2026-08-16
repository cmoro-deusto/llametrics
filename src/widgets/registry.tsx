/**
 * Widget registry: id -> {meta, render}. App renders settings.widgetOrder
 * through this map inside a sortable DnD grid.
 */
import type { ReactNode } from 'react';
import { useDashboard } from '../lib/dashboard';
import { useTicks } from '../hooks/useTicks';
import { COUNTERS, GAUGES, rollingRate } from '../lib/metrics';
import { normalizeBaseUrl } from '../lib/api';
import { useSettings, type Settings } from '../lib/settings';
import type { Tick } from '../lib/history';

/** headline throughput KPIs smooth over the last minute; the instantaneous
 *  server gauge is kept visible as a "now" chip */
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
  // the /metrics gauges only spike when a task ENDS
  { key: 'liveGenTokS', label: 'generation (live)', colorVar: 'chart-1', source: 'derived' },
  // prefill rate of completed prompts (step: holds the last task's rate)
  { key: 'promptPrefillTokS', label: 'prompt (prefill)', colorVar: 'chart-2', source: 'derived', step: true },
];
const REQUESTS_SERIES: ChartSeriesDef[] = [
  { key: GAUGES.requestsProcessing, label: 'processing', colorVar: 'chart-3', source: 'gauges', step: true },
  { key: GAUGES.requestsDeferred, label: 'deferred', colorVar: 'chart-4', source: 'gauges', step: true },
];
const CACHE_SERIES: ChartSeriesDef[] = [
  { key: 'cacheHitRate', label: 'hit rate (0–1)', colorVar: 'chart-1', source: 'derived' },
];
const SPEC_SERIES: ChartSeriesDef[] = [
  { key: 'specAcceptRate', label: 'accept rate (0–1)', colorVar: 'chart-3', source: 'derived' },
];
const BUSY_SERIES: ChartSeriesDef[] = [
  { key: GAUGES.busySlotsPerDecode, label: 'avg busy slots', colorVar: 'chart-5', source: 'gauges', step: true },
];

export interface WidgetMeta {
  title: string;
  span: 3 | 4 | 6 | 12;
}

export interface WidgetRenderProps {
  ticks: Tick[];
}

export const WIDGETS: Record<string, { meta: WidgetMeta; render: (props: WidgetRenderProps) => ReactNode }> = {
  'kpi:predicted-tok-s': {
    meta: { title: 'Generation throughput', span: 3 },
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
    meta: { title: 'Prompt throughput', span: 3 },
    render: ({ ticks }) => {
      const dash = useDashboard();
      const fmt = useFmt();
      const t = dash.lastTick;
      const live = t?.derived.livePromptTokS ?? null;
      const useLive = !!t?.slots?.some((s) => s.processing) && live !== null;
      // prefill rate of the last completed prompt (Δtokens/Δprompt-seconds,
      // uncached) — the real prefill speed; the 60s rolling figure dilutes
      // short prompt bursts across idle time and looks far too low
      const prefill = t?.derived.promptPrefillTokS ?? null;
      const value = useLive
        ? live
        : prefill !== null
          ? prefill
          : rollingRate(ticks, COUNTERS.promptTokens, ROLLING_MS);
      const chip = useLive
        ? 'live · from /slots'
        : prefill !== null
          ? 'prefill · non-cached'
          : '60s rolling';
      return (
        <KpiCard
          label="Prompt throughput"
          value={value}
          unit="rate"
          fmt={fmt}
          sub={<span className="chip">{chip}</span>}
          note="collecting samples…"
        />
      );
    },
  },
  'kpi:session-gen-tok-s': {
    meta: { title: 'Session generation rate', span: 3 },
    render: () => {
      const dash = useDashboard();
      return (
        <KpiCard
          label="Session generation rate"
          value={dash.lastTick?.derived.genTokS ?? null}
          unit="rate"
          fmt={useFmt()}
          sub={<span className="chip">avg over last interval</span>}
          note="needs two samples"
        />
      );
    },
  },
  'kpi:cache-hit-rate': {
    meta: { title: 'Prompt cache hit rate', span: 3 },
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
    meta: { title: 'Speculative accept rate', span: 3 },
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
    meta: { title: 'Requests in flight', span: 3 },
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
    meta: { title: 'Requests deferred', span: 3 },
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
    meta: { title: 'Throughput (tok/s)', span: 6 },
    render: ({ ticks }) => <TrendChart ticks={ticks} series={TOK_S_SERIES} />,
  },
  'chart:requests': {
    meta: { title: 'Requests', span: 6 },
    render: ({ ticks }) => <TrendChart ticks={ticks} series={REQUESTS_SERIES} />,
  },
  'chart:cache-hit-rate': {
    meta: { title: 'Prompt cache hit rate', span: 6 },
    render: ({ ticks }) => <TrendChart ticks={ticks} series={CACHE_SERIES} />,
  },
  'chart:spec-accept-rate': {
    meta: { title: 'Speculative accept rate', span: 6 },
    render: ({ ticks }) => <TrendChart ticks={ticks} series={SPEC_SERIES} />,
  },
  'chart:busy-slots': {
    meta: { title: 'Busy slots per decode', span: 6 },
    render: ({ ticks }) => <TrendChart ticks={ticks} series={BUSY_SERIES} />,
  },

  models: {
    meta: { title: 'Models', span: 6 },
    render: () => {
      const dash = useDashboard();
      return <ModelsCard models={dash.models} fmt={useFmt()} />;
    },
  },
  slots: {
    meta: { title: 'Slots', span: 6 },
    render: () => {
      const dash = useDashboard();
      return <SlotsCard slots={dash.slots} fmt={useFmt()} />;
    },
  },
  counters: {
    meta: { title: 'Counters (since server start)', span: 12 },
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
