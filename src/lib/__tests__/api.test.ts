import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  buildModelCards,
  fetchHealth,
  normalizeBaseUrl,
  slotNextToken,
  type ModelsResponse,
  type SlotInfo,
} from '../api';

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

describe('slotNextToken', () => {
  it('normalizes object and array shapes', () => {
    const obj = { has_next_token: false, has_new_line: false, n_remain: 0, n_decoded: 42 };
    const asObj: SlotInfo = { id: 0, next_token: obj } as SlotInfo;
    const asArr: SlotInfo = { id: 0, next_token: [obj] } as SlotInfo;
    const missing: SlotInfo = { id: 0 } as SlotInfo;
    expect(slotNextToken(asObj)).toBe(obj);
    expect(slotNextToken(asArr)).toBe(obj);
    expect(slotNextToken(missing)).toBeNull();
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

  it('never borrows another model\'s numbers when data[] has no match', () => {
    // multi-model server: only 'known' is described in data[]. 'unknown'
    // must render as empty, NOT inherit known's size/params/context.
    const model = (name: string) => ({
      name, model: name, modified_at: '', size: '', digest: '', type: 'model',
      description: '', tags: [], capabilities: [], parameters: '',
      details: { parent_model: '', format: 'gguf', family: '', families: [], parameter_size: '', quantization_level: '' },
    });
    const cards = buildModelCards({
      models: [model('unknown'), model('known')],
      object: 'list',
      data: [
        {
          id: 'known', aliases: [], tags: [], object: 'model', created: 0, owned_by: 'llamacpp',
          meta: {
            vocab_type: 2, n_vocab: 1234, n_ctx: 4096, n_ctx_train: 8192,
            n_embd: 512, n_params: 7_000_000_000, size: 4_000_000_000, ftype: 'Q4_K_M',
          },
        },
      ],
    });
    const unknown = cards.find((c) => c.name === 'unknown')!;
    expect(unknown.sizeBytes).toBeNull();
    expect(unknown.nParams).toBeNull();
    expect(unknown.nCtx).toBeNull();
    expect(unknown.ftype).toBeNull();
    expect(unknown.aliases).toEqual([]);
    // the matched one still resolves
    expect(cards.find((c) => c.name === 'known')!.sizeBytes).toBe(4_000_000_000);
  });
});

describe('fetchHealth', () => {
  const mockFetch = (impl: () => Promise<unknown>): void => {
    vi.stubGlobal('fetch', vi.fn(impl));
  };
  const jsonRes = (status: number, body: unknown): Response =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the ready state', async () => {
    mockFetch(async () => jsonRes(200, { status: 'ok' }));
    expect(await fetchHealth('http://s')).toEqual({ state: 'ok', message: null, httpStatus: 200 });
  });

  it('recognizes the loading-model 503 instead of calling it an error', async () => {
    // exact upstream body from server-http.cpp middleware_server_state
    mockFetch(async () =>
      jsonRes(503, { error: { message: 'Loading model', type: 'unavailable_error', code: 503 } }),
    );
    expect(await fetchHealth('http://s')).toEqual({
      state: 'loading',
      message: 'Loading model',
      httpStatus: 503,
    });
  });

  it('treats other failures as errors, keeping the server message', async () => {
    mockFetch(async () =>
      jsonRes(500, { error: { message: 'something broke', type: 'server_error', code: 500 } }),
    );
    expect(await fetchHealth('http://s')).toEqual({
      state: 'error',
      message: 'something broke',
      httpStatus: 500,
    });
  });

  it('never throws on a dead socket', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchHealth('http://s')).toEqual({
      state: 'unreachable',
      message: null,
      httpStatus: null,
    });
  });

  it('survives a non-JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError('not json');
        },
      }) as unknown as Response),
    );
    const r = await fetchHealth('http://s');
    // 503 with no parsable body still reads as loading: that is what a
    // proxy in front of a starting server looks like
    expect(r.state).toBe('loading');
    expect(r.message).toBeNull();
  });
});

describe('buildModelCards: router status', () => {
  const base = {
    name: 'M', model: 'M', modified_at: '', size: '', digest: '', type: 'model',
    description: '', tags: [], capabilities: [], parameters: '',
    details: { parent_model: '', format: 'gguf', family: '', families: [], parameter_size: '', quantization_level: '' },
  };
  const datum = (status?: string) => ({
    id: 'M', aliases: [], tags: [], object: 'model', created: 0, owned_by: 'llamacpp',
    ...(status !== undefined ? { status } : {}),
    meta: { vocab_type: 2, n_vocab: 1, n_ctx: 1, n_ctx_train: 1, n_embd: 1, n_params: 1, size: 1, ftype: 'Q4' },
  });

  it('passes through a known lifecycle state', () => {
    const cards = buildModelCards({ models: [base], object: 'list', data: [datum('sleeping')] });
    expect(cards[0].status).toBe('sleeping');
  });

  it('is null on a single-model server that omits the field', () => {
    const cards = buildModelCards({ models: [base], object: 'list', data: [datum()] });
    expect(cards[0].status).toBeNull();
  });

  it('rejects a value the server should never send', () => {
    const cards = buildModelCards({ models: [base], object: 'list', data: [datum('on fire')] });
    expect(cards[0].status).toBeNull();
  });
});
