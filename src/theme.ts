/**
 * Theme engine: mode (light/dark/system) x palette (named hue families) x
 * optional accent override. Everything is CSS custom properties so all
 * components (including uPlot, which reads resolved values) re-skin for
 * free.
 */
import { useSyncExternalStore } from 'react';
import type { PaletteId, ThemeSettings } from './lib/settings';

export const PALETTES: Record<PaletteId, { label: string; accent: string }> = {
  default: { label: 'Default', accent: '#4f8cff' },
  ocean: { label: 'Ocean', accent: '#14b8c4' },
  ember: { label: 'Ember', accent: '#ff7849' },
  moss: { label: 'Moss', accent: '#7bc47f' },
  grape: { label: 'Grape', accent: '#b085f5' },
};

/** bump on every theme change so consumers (charts) can re-read CSS vars */
let themeVersion = 0;
const themeListeners = new Set<() => void>();

export function onThemeChange(fn: () => void): () => void {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

export function useThemeVersion(): number {
  return useSyncExternalStore(onThemeChange, () => themeVersion, () => themeVersion);
}

function relativeLuminance(hex: string): number {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement;
  const dark =
    theme.mode === 'dark' ||
    (theme.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  root.dataset.mode = dark ? 'dark' : 'light';
  root.dataset.palette = theme.palette;

  const accent = theme.accent ?? PALETTES[theme.palette].accent;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-contrast', relativeLuminance(accent) > 0.45 ? '#0b0e13' : '#ffffff');

  themeVersion++;
  for (const l of themeListeners) l();
}

/** Subscribe a matchMedia listener so system mode tracks OS changes. */
export function watchSystemScheme(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
