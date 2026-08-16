/**
 * Minimal Prometheus text-exposition-format parser (version 0.0.4).
 *
 * Handles:
 *  - `# HELP <name> <text>` and `# TYPE <name> <type>` comments (kept as metadata)
 *  - plain samples:              `name 123` / `name 123 1420070400`
 *  - labeled samples:            `name{a="b",c="d"} 123`
 *  - special values: +Inf, -Inf, NaN
 *  - escaped label values (\n, \", \\, \\t)
 *
 * Design note: llama.cpp emits series prefixed `llamacpp:`; we strip that
 * prefix so call sites use bare names (e.g. `tokens_predicted_total`).
 */

export type MetricType = 'counter' | 'gauge' | 'summary' | 'histogram' | 'untyped';

export interface SeriesMeta {
  help?: string;
  type: MetricType;
}

export interface Sample {
  /** metric name with the `llamacpp:` prefix stripped */
  name: string;
  /** label set, empty for unlabeled series */
  labels: Record<string, string>;
  value: number;
  /** unix seconds, present when the sample carries an explicit timestamp */
  timestamp?: number;
}

export interface ParsedMetrics {
  /** all samples in exposition order */
  samples: Sample[];
  /** metadata keyed by (prefixed) metric name */
  meta: Map<string, SeriesMeta>;
}

const PREFIX = 'llamacpp:';

function parseValue(s: string): number {
  if (s === '+Inf' || s === '+INF' || s === 'Inf' || s === 'INF') return Number.POSITIVE_INFINITY;
  if (s === '-Inf' || s === '-INF') return Number.NEGATIVE_INFINITY;
  if (s === 'NaN') return Number.NaN;
  return Number(s);
}

/** Parse a single `name{label="value",...}` head into name + labels. */
export function parseSeriesHead(head: string): { name: string; labels: Record<string, string> } {
  const brace = head.indexOf('{');
  if (brace === -1) {
    return { name: head.trim(), labels: {} };
  }
  const name = head.slice(0, brace).trim();
  const inner = head.slice(brace + 1, head.lastIndexOf('}'));
  const labels: Record<string, string> = {};
  let i = 0;
  while (i < inner.length) {
    // key
    let key = '';
    while (i < inner.length && inner[i] !== '=') key += inner[i++];
    i++; // consume '='
    // value (quoted)
    if (inner[i] !== '"') throw new Error(`Expected quoted label value in "${head}"`);
    i++;
    let val = '';
    while (i < inner.length && inner[i] !== '"') {
      if (inner[i] === '\\' && i + 1 < inner.length) {
        const n = inner[++i];
        val += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n === '"' ? '"' : '\\' + n;
        i++;
      } else {
        val += inner[i++];
      }
    }
    i++; // consume closing quote
    labels[key.trim()] = val;
    // skip to next pair
    while (i < inner.length && (inner[i] === ',' || inner[i] === ' ')) i++;
  }
  return { name, labels };
}

export function parseMetrics(text: string): ParsedMetrics {
  const samples: Sample[] = [];
  const meta = new Map<string, SeriesMeta>();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line === '') continue;

    if (line.startsWith('#')) {
      const m = line.match(/^#\s+(HELP|TYPE)\s+(\S+)\s*(.*)$/);
      if (!m) continue; // other comment kinds (e.g. # EOF) are ignored
      const [, kind, name, rest] = m;
      const cur = meta.get(name) ?? { type: 'untyped' as MetricType };
      if (kind === 'HELP') cur.help = rest;
      else cur.type = rest as MetricType;
      meta.set(name, cur);
      continue;
    }

    const sp = line.search(/\s/);
    if (sp === -1) continue;
    const head = line.slice(0, sp);
    const rest = line.slice(sp + 1).trim();
    const { name, labels } = parseSeriesHead(head);

    const parts = rest.split(/\s+/);
    const value = parseValue(parts[0]);
    const sample: Sample = {
      name: name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name,
      labels,
      value,
    };
    if (parts.length > 1) sample.timestamp = Number(parts[1]);
    samples.push(sample);
  }

  return { samples, meta };
}

/**
 * Index unlabeled samples by bare name. Labeled series (e.g.
 * spec_decode_num_accepted_tokens_per_pos_total) are aggregated to a
 * per-name array of {labels, value} so callers can keep the breakdown.
 */
export interface IndexedMetrics {
  /** unlabeled values: bare name -> number */
  flat: Map<string, number>;
  /** labeled series: bare name -> [{labels, value}] in order of position label */
  labeled: Map<string, { labels: Record<string, string>; value: number }[]>;
  meta: Map<string, SeriesMeta>;
}

export function indexMetrics(parsed: ParsedMetrics): IndexedMetrics {
  const flat = new Map<string, number>();
  const labeled = new Map<string, { labels: Record<string, string>; value: number }[]>();
  for (const s of parsed.samples) {
    if (Object.keys(s.labels).length === 0) {
      flat.set(s.name, s.value);
    } else {
      const arr = labeled.get(s.name) ?? [];
      arr.push({ labels: s.labels, value: s.value });
      labeled.set(s.name, arr);
    }
  }
  // keep the per-position breakdown ordered by numeric position label
  for (const arr of labeled.values()) {
    arr.sort((a, b) => Number(a.labels.position ?? 0) - Number(b.labels.position ?? 0));
  }
  return { flat, labeled, meta: parsed.meta };
}
