import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { settingsStore } from './lib/settings';
import { applyTheme, watchSystemScheme } from './theme';
import App from './App';
import './styles.css';

// CLI `--base-url` prefill: the served index.html injects this before us.
const prefill = (window as unknown as { __LLAMETRICS_PREFILL__?: string }).__LLAMETRICS_PREFILL__;
if (prefill) settingsStore.prefillIfEmpty(prefill);

// initial theme
applyTheme(settingsStore.get().theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// track OS scheme changes while in system mode
watchSystemScheme(() => {
  const t = settingsStore.get().theme;
  if (t.mode === 'system') applyTheme(t);
});
