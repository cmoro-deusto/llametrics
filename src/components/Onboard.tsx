/** First-run / unconfigured state: ask for the llama-server base URL. */
import { useState } from 'react';
import { settingsStore } from '../lib/settings';
import { refreshDashboardSettings } from '../lib/dashboard';
import { PALETTES } from '../theme';

export function Onboard() {
  const [url, setUrl] = useState('');

  const connect = () => {
    if (!url.trim()) return;
    settingsStore.set({ baseUrl: url.trim() });
    refreshDashboardSettings();
  };

  return (
    <div className="widget onboard">
      <h1>🦙 llametrics</h1>
      <p>
        A themeable dashboard for <b>llama-server</b>. Enter the base URL of your
        llama-server instance — metrics are read from its <code>/metrics</code>,{' '}
        <code>/models</code>, <code>/slots</code> and <code>/health</code> endpoints.
      </p>
      <input
        type="url"
        placeholder="http://10.0.0.57:9080"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && connect()}
        aria-label="llama-server base URL"
        autoFocus
      />
      <div className="row" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn" onClick={connect}>
          Connect
        </button>
        <span className="hint">e.g. http://localhost:8080 — the server must allow CORS (llama.cpp default: --cors-origins *)</span>
      </div>
      <div className="muted" style={{ marginTop: 16 }}>
        Palettes: {Object.values(PALETTES).map((p) => p.label).join(' · ')} — theme and
        everything else is configurable in Settings once connected.
      </div>
    </div>
  );
}
