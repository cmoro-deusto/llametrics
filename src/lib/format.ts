/** Number formatting: human-readable vs raw, per the user's setting. */

export type NumberFormat = 'human' | 'raw';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatBytes(n: number | null | undefined, fmt: NumberFormat = 'human'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (fmt === 'raw') return n.toLocaleString('en-US');
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
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

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDateTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
