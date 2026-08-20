/** Number formatting: human-readable vs raw, per the user's setting. */

export type NumberFormat = 'human' | 'raw';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
/**
 * Decimal (SI) step, matching the KB/MB/GB labels above. This used to
 * divide by 1024 while still printing KB/MB/GB, which understated every
 * size by ~2.4% per step — a 17.91 GB model read "16.68 GB".
 */
const STEP = 1000;

export function formatBytes(n: number | null | undefined, fmt: NumberFormat = 'human'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (fmt === 'raw') return n.toLocaleString('en-US');
  let i = 0;
  let v = n;
  while (Math.abs(v) >= STEP && i < UNITS.length - 1) {
    v /= STEP;
    i++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${UNITS[i]}`;
}

export function formatCount(n: number | null | undefined, fmt: NumberFormat = 'human'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (fmt === 'raw') return Math.round(n).toLocaleString('en-US');
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString('en-US');
}

export function formatRate(n: number | null | undefined, fmt: NumberFormat = 'human'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (fmt === 'raw') return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(2)}k`;
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

export function formatPercent(n: number | null | undefined, fmt: NumberFormat = 'human'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(fmt === 'raw' ? 3 : 1)}%`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
