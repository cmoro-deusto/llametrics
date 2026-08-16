/** KPI card: one headline number with unit + secondary chips. */
import { formatCount, formatPercent, formatRate, type NumberFormat } from '../lib/format';

export type KpiUnit = 'rate' | 'percent' | 'count' | 'num';

export function KpiCard({
  label,
  value,
  unit,
  fmt,
  sub,
  note,
}: {
  label: string;
  value: number | null | undefined;
  unit: KpiUnit;
  fmt: NumberFormat;
  sub?: React.ReactNode;
  /** shown when the value is unavailable (e.g. not enough samples yet) */
  note?: string;
}) {
  const hasValue = value !== null && value !== undefined && Number.isFinite(value);
  let display: string;
  let unitLabel = '';
  if (!hasValue) display = '—';
  else {
    switch (unit) {
      case 'rate':
        display = formatRate(value, fmt);
        unitLabel = 'tok/s';
        break;
      case 'percent':
        display = formatPercent(value, fmt);
        break;
      case 'count':
        display = formatCount(value, fmt);
        break;
      case 'num':
        display = value.toLocaleString('en-US', { maximumFractionDigits: 2 });
        break;
    }
  }
  return (
    <div
      className="widget-body"
      role="group"
      aria-label={label}
    >
      <div className="kpi-value">
        {display}
        {unitLabel && <span className="kpi-unit">{unitLabel}</span>}
      </div>
      <div className="kpi-sub">
        {hasValue ? sub : <span className="muted">{note ?? 'waiting for samples'}</span>}
      </div>
    </div>
  );
}
