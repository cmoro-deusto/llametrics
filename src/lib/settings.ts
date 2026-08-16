/**
 * User settings: persisted in localStorage, JSON export/import.
 * Small external store (useSyncExternalStore-friendly) so any component
 * can subscribe.
 */
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type PaletteId = 'default' | 'ocean' | 'ember' | 'moss' | 'grape';

export interface NamedEndpoint {
  id: string;
  name: string;
  url: string;
}

export interface ThemeSettings {
  mode: ThemeMode;
  palette: PaletteId;
  /** null = use the palette's built-in accent */
  accent: string | null;
}

export interface Settings {
  /** active base URL ('' = not configured yet) */
  baseUrl: string;
  endpoints: NamedEndpoint[];
  theme: ThemeSettings;
  /** poll interval in ms, 1000..60000 */
  pollMs: number;
  /** chart window in minutes */
  chartWindowMin: number;
  numberFormat: 'human' | 'raw';
  /** all widget ids in display order */
  widgetOrder: string[];
  /** hidden widget ids */
  widgetHidden: Record<string, boolean>;
}

const STORAGE_KEY = 'llametrics.settings.v1';

export const DEFAULT_WIDGET_ORDER = [
  'kpi:predicted-tok-s',
  'kpi:prompt-tok-s',
  'kpi:session-gen-tok-s',
  'kpi:cache-hit-rate',
  'kpi:spec-accept-rate',
  'kpi:requests-processing',
  'kpi:requests-deferred',
  'chart:tok-s',
  'chart:requests',
  'chart:cache-hit-rate',
  'chart:spec-accept-rate',
  'chart:busy-slots',
  'models',
  'slots',
  'counters',
] as const;

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: '',
  endpoints: [],
  theme: { mode: 'system', palette: 'default', accent: null },
  pollMs: 2000,
  chartWindowMin: 15,
  numberFormat: 'human',
  widgetOrder: [...DEFAULT_WIDGET_ORDER],
  widgetHidden: {},
};

export const CHART_WINDOW_PRESETS_MIN = [5, 15, 60, 360, 1440, 4320] as const;

function isPaletteId(v: unknown): v is PaletteId {
  return v === 'default' || v === 'ocean' || v === 'ember' || v === 'moss' || v === 'grape';
}

/** Merge a parsed object over defaults; drop unknown shapes defensively. */
export function sanitizeSettings(input: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (typeof input !== 'object' || input === null) return { ...d };
  const o = input as Record<string, unknown>;
  const endpoints = Array.isArray(o.endpoints)
    ? o.endpoints
        .filter(
          (e): e is NamedEndpoint =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as NamedEndpoint).id === 'string' &&
            typeof (e as NamedEndpoint).name === 'string' &&
            typeof (e as NamedEndpoint).url === 'string',
        )
        .map((e) => ({ id: e.id, name: e.name, url: e.url }))
    : d.endpoints;
  const themeRaw = (typeof o.theme === 'object' && o.theme !== null ? o.theme : {}) as Record<string, unknown>;
  const theme: ThemeSettings = {
    mode: themeRaw.mode === 'light' || themeRaw.mode === 'dark' || themeRaw.mode === 'system'
      ? themeRaw.mode
      : d.theme.mode,
    palette: isPaletteId(themeRaw.palette) ? themeRaw.palette : d.theme.palette,
    accent:
      typeof themeRaw.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(themeRaw.accent)
        ? themeRaw.accent
        : null,
  };
  const widgetOrder = Array.isArray(o.widgetOrder)
    ? (o.widgetOrder.filter((w): w is string => typeof w === 'string') as string[])
    : d.widgetOrder;
  // keep order entries for known widgets, then append any newly added ones
  const known = new Set<string>([...DEFAULT_WIDGET_ORDER, ...widgetOrder]);
  const ordered = widgetOrder.filter((w) => known.has(w));
  for (const w of DEFAULT_WIDGET_ORDER) if (!ordered.includes(w)) ordered.push(w);

  const pollMs =
    typeof o.pollMs === 'number' && Number.isFinite(o.pollMs)
      ? Math.min(60000, Math.max(1000, Math.round(o.pollMs)))
      : d.pollMs;
  const chartWindowMin =
    typeof o.chartWindowMin === 'number' && Number.isFinite(o.chartWindowMin)
      ? Math.min(4320, Math.max(1, Math.round(o.chartWindowMin)))
      : d.chartWindowMin;

  return {
    baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : d.baseUrl,
    endpoints,
    theme,
    pollMs,
    chartWindowMin,
    numberFormat: o.numberFormat === 'raw' ? 'raw' : 'human',
    widgetOrder: ordered,
    widgetHidden:
      typeof o.widgetHidden === 'object' && o.widgetHidden !== null
        ? (o.widgetHidden as Record<string, boolean>)
        : {},
  };
}

function readStorage(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = readStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export const settingsStore = {
  get: (): Settings => current,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(patch: Partial<Settings>): void {
    current = sanitizeSettings({ ...current, ...patch });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // storage full/blocked: keep in-memory state
    }
    emit();
  },
  replace(next: Settings): void {
    current = sanitizeSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // ignore
    }
    emit();
  },
  reset(): void {
    settingsStore.replace({ ...DEFAULT_SETTINGS });
  },
  /** CLI --base-url prefill: only applied when the user has not configured one. */
  prefillIfEmpty(url: string): void {
    if (current.baseUrl === '' && url) settingsStore.set({ baseUrl: url });
  },
  exportJson(): string {
    return JSON.stringify(current, null, 2);
  },
  importJson(text: string): Settings {
    const parsed = sanitizeSettings(JSON.parse(text));
    settingsStore.replace(parsed);
    return parsed;
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
}
