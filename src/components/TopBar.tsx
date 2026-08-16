/** Sticky top bar: brand, connection status, model name, endpoint switcher, settings. */
import { settingsStore, useSettings } from '../lib/settings';
import { useDashboard } from '../lib/dashboard';
import { refreshDashboardSettings } from '../lib/dashboard';

const STATUS_LABEL: Record<string, string> = {
  idle: 'not connected',
  ok: 'live',
  stale: 'stale — retrying',
  down: 'unreachable',
};

export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const settings = useSettings();
  const dash = useDashboard();
  const model = dash.models && dash.models.length > 0 ? dash.models[0].name : null;

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
      <span className={`status-dot ${dash.status}`} aria-hidden />
      <span className="status-label">{STATUS_LABEL[dash.status]}</span>
      {model && <span className="model-name" title={model}>{model}</span>}
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
