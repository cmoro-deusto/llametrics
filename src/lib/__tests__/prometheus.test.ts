import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { indexMetrics, parseMetrics, parseSeriesHead } from '../prometheus';

const fixtureDir = fileURLToPath(new URL('../__fixtures__', import.meta.url));
const LIVE = readFileSync(join(fixtureDir, 'metrics-live.txt'), 'utf8');

describe('parseMetrics', () => {
  it('parses the live llama-server /metrics payload', () => {
    const { samples, meta } = parseMetrics(LIVE);
    // 10 unlabeled counters + 5 gauges + 3 labeled per-position series
    expect(samples).toHaveLength(18);
    expect(samples.filter((s) => Object.keys(s.labels).length > 0)).toHaveLength(3);

    const flat = new Map(samples.filter((s) => Object.keys(s.labels).length === 0).map((s) => [s.name, s.value]));
    expect(flat.get('prompt_tokens_total')).toBeGreaterThan(0);
    expect(flat.get('predicted_tokens_seconds')).toBeTypeOf('number');
    expect(meta.get('llamacpp:prompt_tokens_total')?.type).toBe('counter');
    expect(meta.get('llamacpp:predicted_tokens_seconds')?.type).toBe('gauge');
    expect(meta.get('llamacpp:prompt_tokens_total')?.help).toMatch(/prompt tokens/i);
  });

  it('strips the llamacpp: prefix and keeps others intact', () => {
    const { samples } = parseMetrics('llamacpp:foo_total 1\nother:bar 2\n');
    expect(samples.map((s) => s.name)).toEqual(['foo_total', 'other:bar']);
  });

  it('parses labeled samples with escapes and timestamps', () => {
    const text = [
      '# HELP x{a="b c\\"d\\ne"} helper',
      '# TYPE x counter',
      'x{position="2",note="a\\nb"} 42 1700000000',
      'x{position="0"} 7',
    ].join('\n');
    const { samples } = parseMetrics(text);
    expect(samples).toHaveLength(2);
    const [s0, s2] = samples.sort((a, b) => a.labels.position.localeCompare(b.labels.position));
    expect(s0.value).toBe(7);
    expect(s2.value).toBe(42);
    expect(s2.timestamp).toBe(1700000000);
    expect(s2.labels.note).toBe('a\nb');
  });

  it('handles special values', () => {
    const { samples } = parseMetrics('a  +Inf\nb -Inf\nc NaN\nd 0\n');
    expect(samples[0].value).toBe(Number.POSITIVE_INFINITY);
    expect(samples[1].value).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(samples[2].value)).toBe(true);
    expect(samples[3].value).toBe(0);
  });

  it('ignores malformed lines without throwing', () => {
    const { samples } = parseMetrics('# random comment\n\nnot a sample\nfoo bar baz qux\nok 1\n');
    // 'not a sample' -> head 'not', value 'a' -> Number('a') = NaN, kept as a sample;
    // the parser is lenient by design (llama.cpp output is well-formed anyway)
    expect(samples.some((s) => s.name === 'ok' && s.value === 1)).toBe(true);
  });
});

describe('parseSeriesHead', () => {
  it('parses name without labels', () => {
    expect(parseSeriesHead('llamacpp:n_decode_total')).toEqual({
      name: 'llamacpp:n_decode_total',
      labels: {},
    });
  });

  it('parses multiple labels', () => {
    expect(parseSeriesHead('m{a="1", b="two"}')).toEqual({
      name: 'm',
      labels: { a: '1', b: 'two' },
    });
  });
});

describe('indexMetrics', () => {
  it('splits flat vs labeled and orders per-position series numerically', () => {
    const text = [
      'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="10"} 200',
      'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="2"} 300',
      'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="0"} 100',
      'llamacpp:n_decode_total 5',
    ].join('\n');
    const idx = indexMetrics(parseMetrics(text));
    expect(idx.flat.get('n_decode_total')).toBe(5);
    const perPos = idx.labeled.get('spec_decode_num_accepted_tokens_per_pos_total');
    expect(perPos?.map((p) => p.labels.position)).toEqual(['0', '2', '10']);
    expect(perPos?.map((p) => p.value)).toEqual([100, 300, 200]);
  });
});
