/**
 * Settings modal: server (base URL + named endpoints), theme, polling,
 * chart window, number format, widget visibility, storage maintenance,
 * and settings JSON export/import.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CHART_WINDOW_PRESETS_MIN,
  settingsStore,
  useSettings,
  type NamedEndpoint,
  type PaletteId,
  type ThemeMode,
} from '../lib/settings';
import { refreshDashboardSettings, useDashboard } from '../lib/dashboard';
import { historyStore } from '../lib/history';
import { genId } from '../lib/id';
import { activeServerKey, WIDGETS } from '../widgets/registry';
import { PALETTES } from '../theme';
import { formatCount, type NumberFormat } from '../lib/format';

const POLL_PRESETS_MS = [1000, 2000, 5000, 10000, 30000, 60000];

function windowLabel(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${min / 60} h`;
  return `${min / 1440} d`;
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const dash = useDashboard();
  const [endpointName, setEndpointName] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [tickCount, setTickCount] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    historyStore.count().then(setTickCount).catch(() => setTickCount(null));
  }, []);

  const setAndRefresh = (patch: Parameters<typeof settingsStore.set>[0]) => {
    settingsStore.set(patch);
    refreshDashboardSettings();
  };

  const addEndpoint = () => {
    if (!endpointName.trim() || !endpointUrl.trim()) return;
    const ep: NamedEndpoint = {
      id: genId('ep'),
      name: endpointName.trim(),
      url: endpointUrl.trim(),
    };
    settingsStore.set({ endpoints: [...settings.endpoints, ep] });
    setEndpointName('');
    setEndpointUrl('');
  };

  const updateEndpoint = (id: string, patch: Partial<NamedEndpoint>) => {
    settingsStore.set({
      endpoints: settings.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };

  const exportSettings = () => {
    const blob = new Blob([settingsStore.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'llametrics-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importSettings = (file: File) => {
    file.text().then((text) => {
      try {
        settingsStore.importJson(text);
        refreshDashboardSettings();
      } catch (e) {
        alert(`Invalid settings file: ${(e as Error).message}`);
      }
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Settings">
        <h2>
          Settings
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </h2>

        <section className="section">
          <h3>Server</h3>
          <div className="field">
            <span>Base URL (applied immediately)</span>
            <input
              type="url"
              value={settings.baseUrl}
              placeholder="http://localhost:8080"
              onChange={(e) => setAndRefresh({ baseUrl: e.target.value })}
            />
          </div>
          {dash.lastError && dash.status !== 'ok' && (
            <div className="error-text">
              {dash.lastError}
              {dash.status === 'down' && dash.failStreak >= 3
                ? ' — retrying with backoff. If the browser blocks the request, check the server’s CORS configuration.'
                : ''}
            </div>
          )}

          <div className="field">
            <span>Saved endpoints</span>
            {settings.endpoints.map((e) => (
              <div className="endpoint-row" key={e.id}>
                <input
                  className="grow"
                  style={{ width: 130, flex: '0 1 130px' }}
                  value={e.name}
                  onChange={(ev) => updateEndpoint(e.id, { name: ev.target.value })}
                  aria-label="Endpoint name"
                />
                <input
                  className="grow"
                  type="url"
                  value={e.url}
                  onChange={(ev) => updateEndpoint(e.id, { url: ev.target.value })}
                  aria-label="Endpoint URL"
                />
                <code>{e.url === settings.baseUrl ? 'active' : ''}</code>
                <button
                  className="hide-btn"
                  title="Remove endpoint"
                  onClick={() =>
                    settingsStore.set({
                      endpoints: settings.endpoints.filter((x) => x.id !== e.id),
                    })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="endpoint-row" style={{ marginTop: 8 }}>
              <input
                className="grow"
                style={{ width: 130, flex: '0 1 130px' }}
                placeholder="name"
                value={endpointName}
                onChange={(e) => setEndpointName(e.target.value)}
              />
              <input
                className="grow"
                type="url"
                placeholder="http://host:port"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
              />
              <button
                className="btn secondary"
                onClick={addEndpoint}
                disabled={!endpointName.trim() || !endpointUrl.trim()}
              >
                Add
              </button>
            </div>
          </div>
        </section>

        <section className="section">
          <h3>Theme</h3>
          <div className="row">
            {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
              <label key={m}>
                <input
                  type="radio"
                  name="theme-mode"
                  checked={settings.theme.mode === m}
                  onChange={() => settingsStore.set({ theme: { ...settings.theme, mode: m } })}
                />
                {m}
              </label>
            ))}
          </div>
          <div className="theme-swatches">
            {(Object.keys(PALETTES) as PaletteId[]).map((p) => (
              <button
                key={p}
                className={`swatch-btn${settings.theme.palette === p ? ' active' : ''}`}
                onClick={() => settingsStore.set({ theme: { ...settings.theme, palette: p, accent: null } })}
              >
                <span className="swatch-dot" style={{ background: PALETTES[p].accent }} />
                {PALETTES[p].label}
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              Accent
              <input
                type="color"
                value={settings.theme.accent ?? PALETTES[settings.theme.palette].accent}
                onChange={(e) => settingsStore.set({ theme: { ...settings.theme, accent: e.target.value } })}
                aria-label="Accent color"
              />
            </label>
            {settings.theme.accent !== null && (
              <button
                className="btn secondary"
                onClick={() => settingsStore.set({ theme: { ...settings.theme, accent: null } })}
              >
                Reset accent
              </button>
            )}
          </div>
        </section>

        <section className="section">
          <h3>Data</h3>
          <div className="row">
            <span style={{ fontSize: 13 }}>Poll interval</span>
            <select
              value={settings.pollMs}
              onChange={(e) => setAndRefresh({ pollMs: Number(e.target.value) })}
              aria-label="Poll interval"
            >
              {POLL_PRESETS_MS.map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000}s
                </option>
              ))}
              {!POLL_PRESETS_MS.includes(settings.pollMs) && (
                <option value={settings.pollMs}>{settings.pollMs / 1000}s</option>
              )}
            </select>
            <span className="muted">polling pauses while the tab is hidden</span>
          </div>
          <div className="row">
            <span style={{ fontSize: 13 }}>Chart window</span>
            <select
              value={settings.chartWindowMin}
              onChange={(e) => setAndRefresh({ chartWindowMin: Number(e.target.value) })}
              aria-label="Chart window"
            >
              {CHART_WINDOW_PRESETS_MIN.map((m) => (
                <option key={m} value={m}>
                  {windowLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <span style={{ fontSize: 13 }}>Numbers</span>
            {(['human', 'raw'] as NumberFormat[]).map((f) => (
              <label key={f}>
                <input
                  type="radio"
                  name="num-format"
                  checked={settings.numberFormat === f}
                  onChange={() => settingsStore.set({ numberFormat: f })}
                />
                {f === 'human' ? 'human-readable (1.7 GB, 27.3B)' : 'raw (1,791,239,782)'}
              </label>
            ))}
          </div>
        </section>

        <section className="section">
          <h3>Widgets</h3>
          <div className="widget-toggle-list">
            {settings.widgetOrder.map((id) =>
              WIDGETS[id] ? (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={!settings.widgetHidden[id]}
                    onChange={(e) => {
                      const next = { ...settings.widgetHidden };
                      if (e.target.checked) delete next[id];
                      else next[id] = true;
                      settingsStore.set({ widgetHidden: next });
                    }}
                  />
                  {WIDGETS[id].meta.title}
                </label>
              ) : null,
            )}
          </div>
          <span className="muted">Reorder widgets by dragging their ⋮⋮ handle on the grid.</span>
        </section>

        <section className="section">
          <h3>Storage & settings</h3>
          <div className="row">
            <span className="muted">
              history: {tickCount != null ? formatCount(tickCount) : '…'} ticks stored (7-day retention)
            </span>
            <button
              className="btn danger"
              onClick={() => {
                const key = activeServerKey(settings);
                historyStore
                  .clearServer(key)
                  .then(() => historyStore.count().then(setTickCount))
                  .catch(() => undefined);
              }}
              disabled={!settings.baseUrl}
            >
              Clear history (this server)
            </button>
            <button
              className="btn danger"
              onClick={() => {
                historyStore
                  .clearAll()
                  .then(() => historyStore.count().then(setTickCount))
                  .catch(() => undefined);
              }}
            >
              Clear all history
            </button>
          </div>
          <div className="row">
            <button className="btn secondary" onClick={exportSettings}>
              Export settings (JSON)
            </button>
            <button className="btn secondary" onClick={() => fileRef.current?.click()}>
              Import settings
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importSettings(f);
                e.target.value = '';
              }}
            />
            <button
              className="btn danger"
              onClick={() => {
                if (confirm('Reset all llametrics settings?')) {
                  settingsStore.reset();
                  refreshDashboardSettings();
                }
              }}
            >
              Reset settings
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
