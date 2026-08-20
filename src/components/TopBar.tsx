/** Sticky top bar: brand, connection status, model name, endpoint switcher, settings. */
import { settingsStore, useSettings } from '../lib/settings';
import { useNow } from '../hooks/useNow';
import { formatDuration } from '../lib/format';
import { useDashboard } from '../lib/dashboard';
import { refreshDashboardSettings } from '../lib/dashboard';

const STATUS_LABEL: Record<string, string> = {
  idle: 'not connected',
  ok: 'live',
  stale: 'stale — retrying',
  down: 'unreachable',
};

/**
 * /health knows things the /metrics status cannot express: while the model
 * loads, every endpoint 503s, so the metrics-derived status is merely
 * 'down' when the truthful answer is "it is starting up". Health takes
 * precedence in exactly those cases.
 */
function connLabel(
  status: string,
  health: { state: string; message: string | null } | null,
): { dot: 'ok' | 'stale' | 'down' | 'idle'; label: string } {
  if (health?.state === 'loading') return { dot: 'stale', label: 'loading model…' };
  if (status === 'idle') return { dot: 'idle', label: STATUS_LABEL.idle };
  if (health?.state === 'error' && status !== 'ok') {
    return { dot: 'down', label: health.message ? `server error: ${health.message}` : 'server error' };
  }
  const dot = status === 'ok' ? 'ok' : status === 'stale' ? 'stale' : 'down';
  return { dot, label: STATUS_LABEL[status] ?? status };
}

export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const settings = useSettings();
  const dash = useDashboard();
  // With a multi-model server, models[0] is an arbitrary pick — naming the
  // whole dashboard after it is wrong. Show the name only when there is
  // exactly one, otherwise report the count.
  const models = dash.models;
  const modelLabel =
    !models || models.length === 0
      ? null
      : models.length === 1
        ? models[0].name
        : `${models.length} models`;

  const conn = connLabel(dash.status, dash.health);
  // Age of the newest data on screen. Every panel keeps rendering the last
  // values while a server is unreachable, with nothing saying how old they
  // are; shown once the data is meaningfully behind the poll cadence so a
  // healthy dashboard is not littered with "1s ago".
  const now = useNow();
  const dataAgeMs = dash.lastOkAt !== null ? now - dash.lastOkAt : null;
  const showAge =
    dataAgeMs !== null && dataAgeMs > Math.max(5000, settings.pollMs * 3);

  const currentUrl = settings.baseUrl;
  const options = [
    ...settings.endpoints.map((e) => ({ url: e.url, label: e.name })),
  ];
  // ensure the active URL is always selectable
  if (currentUrl && !options.some((o) => o.url === currentUrl)) {
    options.push({ url: currentUrl, label: currentUrl });
  }

  return (
    <header className="topbar">
      <span className="brand">
        <span aria-hidden>🦙</span> llametrics
      </span>
      <span className={`status-dot ${conn.dot}`} aria-hidden />
      <span className="status-label">{conn.label}</span>
      {showAge && (
        <span className="status-label" title="Age of the newest data on screen">
          · data {formatDuration(dataAgeMs! / 1000)} old
        </span>
      )}
      {modelLabel && (
        <span
          className="model-name"
          title={models && models.length > 1 ? models.map((m) => m.name).join(', ') : modelLabel}
        >
          {modelLabel}
        </span>
      )}
      <span className="spacer" />
      {options.length > 0 && (
        <select
          value={currentUrl}
          onChange={(e) => {
            settingsStore.set({ baseUrl: e.target.value });
            refreshDashboardSettings();
          }}
          title="Switch endpoint"
          aria-label="Endpoint"
        >
          {options.map((o) => (
            <option key={o.url} value={o.url}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <button className="icon-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
  );
}
