import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildModelCards, normalizeBaseUrl, type ModelsResponse } from '../api';

const fixtureDir = fileURLToPath(new URL('../__fixtures__', import.meta.url));
const LIVE_MODELS = JSON.parse(readFileSync(join(fixtureDir, 'models-live.json'), 'utf8')) as ModelsResponse;

describe('normalizeBaseUrl', () => {
  it('adds scheme, strips trailing slashes', () => {
    expect(normalizeBaseUrl('10.0.0.57:9080')).toBe('http://10.0.0.57:9080');
    expect(normalizeBaseUrl('http://10.0.0.57:9080///')).toBe('http://10.0.0.57:9080');
    expect(normalizeBaseUrl('https://example.com/x/')).toBe('https://example.com/x');
  });
  it('empty stays empty', () => {
    expect(normalizeBaseUrl('')).toBe('');
    expect(normalizeBaseUrl('   ')).toBe('');
  });
});

describe('buildModelCards', () => {
  it('merges models[] names with data[] numeric details (live fixture)', () => {
    const cards = buildModelCards(LIVE_MODELS);
    expect(cards).toHaveLength(1);
    const m = cards[0];
    expect(m.name).toBe('Qwen3.8 27B Q4');
    expect(m.ftype).toBe('Q4_K - Small');
    expect(m.sizeBytes).toBe(17912397824);
    expect(m.nParams).toBe(27320697856);
    expect(m.nCtx).toBe(262144);
    expect(m.nVocab).toBe(248320);
    expect(m.nEmbD).toBe(5120);
    expect(m.aliases).toContain('Qwen3.8 27B Q4');
  });

  it('falls back gracefully when data[] is missing entries', () => {
    const cards = buildModelCards({
      models: [{
        name: 'M', model: 'M', modified_at: '', size: '', digest: '', type: 'model',
        description: '', tags: ['t1'], capabilities: ['completion'], parameters: '',
        details: { parent_model: '', format: 'gguf', family: '', families: [], parameter_size: '', quantization_level: '' },
      }],
      object: 'list',
      data: [],
    });
    expect(cards[0].name).toBe('M');
    expect(cards[0].ftype).toBeNull();
    expect(cards[0].nParams).toBeNull();
    expect(cards[0].tags).toContain('t1');
  });
});
