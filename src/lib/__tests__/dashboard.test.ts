// @vitest-environment jsdom
/**
 * Engine wiring integration test (fake timers + mocked fetchers +
 * fake-indexeddb).
 *
 * liveSlotRate is unit-tested in isolation, but the ENGINE must carry the
 * latest /slots sample into the next tick (this.prevSlots) or every live
 * rate silently collapses to null from the second tick on — a regression
 * that shipped and made the throughput KPI/charts look dead.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchHealth,
  fetchMetricsText,
  fetchModels,
  fetchSlots,
  type ModelsResponse,
} from '../api';
import { dashboard } from '../dashboard';
import { historyStore } from '../history';
import { settingsStore } from '../settings';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    fetchMetricsText: vi.fn(),
    fetchModels: vi.fn(),
    fetchSlots: vi.fn(),
    fetchHealth: vi.fn(),
  };
});

const BASE = 'http://testserver:8080';
const POLL_MS = 2000;
// prompt counters advance per scrape: +250 tokens / +0.25 s, so the
// prefill rate (Δtokens/Δseconds) of every interval is 1000 tok/s while
// the interval-averaged rate over the 2 s poll is only 125 tok/s.
// NOTE: the `llamacpp:` prefix is mandatory — the parser only strips that
// prefix, so other prefixes parse but never match the COUNTERS/GAUGES names
const metricsText = (n: number): string =>
  [
    '# TYPE llamacpp:prompt_tokens_total counter',
    `llamacpp:prompt_tokens_total ${1000 + n * 250}`,
    '# TYPE llamacpp:prompt_seconds_total counter',
    `llamacpp:prompt_seconds_total ${(n * 0.25).toFixed(3)}`,
    '# TYPE llamacpp:tokens_predicted_total counter',
    'llamacpp:tokens_predicted_total 5000',
    '# TYPE llamacpp:requests_processing gauge',
    'llamacpp:requests_processing 1',
  ].join('\n');

const SLOT_PARAMS = {
  seed: 0,
  temperature: 1,
  dynatemp_range: 0,
  dynatemp_exponent: 0,
  top_k: 40,
  top_p: 0.9,
  min_p: 0,
  top_n_sigma: -1,
  xtc_probability: 0,
  xtc_threshold: 0.1,
  typical_p: 1,
  repeat_last_n: 64,
  repeat_penalty: 1.1,
  presence_penalty: 0,
  frequency_penalty: 0,
  dry_multiplier: 0,
  dry_base: 1.75,
  dry_allowed_length: 0,
  dry_penalty_last_n: -1,
  mirostat: 0,
  mirostat_tau: 5,
  mirostat_eta: 0.1,
  adaptive_target: 0.5,
  adaptive_decay: 0.9,
  max_tokens: -1,
  n_predict: -1,
  n_keep: 0,
  n_discard: 0,
  ignore_eos: false,
  stream: true,
  n_probs: 0,
};

const MODELS: ModelsResponse = {
  models: [
    {
      name: 'm.gguf',
      model: 'm.gguf',
      modified_at: '2026-08-16T00:00:00Z',
      size: '1 GB',
      digest: 'abc',
      type: 'Q4_K_M',
      description: '',
      tags: [],
      capabilities: ['prompt_cache', 'speculative_decoding'],
      parameters: '17B',
      details: {
        parent_model: 'base.gguf',
        format: 'gguf',
        family: 'qwen3',
        families: ['qwen3'],
        parameter_size: '17B',
        quantization_level: 'Q4_K_M',
      },
    },
  ],
  object: 'list',
  data: [
    {
      id: 'm.gguf',
      aliases: [],
      tags: [],
      object: 'model',
      created: 0,
      owned_by: 'llama.cpp',
      meta: {
        vocab_type: 1,
        n_vocab: 248320,
        n_ctx: 8192,
        n_ctx_train: 0,
        n_embd: 5120,
        n_params: 27000000000,
        size: 1000,
        ftype: 'Q4_K_M',
      },
    },
  ],
};

const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('dashboard engine: live slot rate wiring', () => {
  let slotCalls: number;
  let metricsCalls: number;

  beforeEach(async () => {
    // clear IDB with real timers (fake-indexeddb internals), then go fake
    await historyStore.clearAll().catch(() => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T12:00:00Z'));

    metricsCalls = 0;
    vi.mocked(fetchMetricsText).mockImplementation(async () => {
      metricsCalls += 1;
      return metricsText(metricsCalls);
    });
    vi.mocked(fetchHealth).mockResolvedValue({ state: 'ok', message: null, httpStatus: 200 });
    vi.mocked(fetchModels).mockResolvedValue(MODELS);

    // simulate one active slot decoding at 25 tok/s (50 tokens per
    // 2 s poll); n_prompt_tokens_processed stays put
    slotCalls = 0;
    vi.mocked(fetchSlots).mockImplementation(async () => {
      slotCalls += 1;
      return [
        {
          id: 0,
          n_ctx: 8192,
          speculative: false,
          is_processing: true,
          id_task: 1,
          n_prompt_tokens: 100,
          n_prompt_tokens_processed: 100,
          n_prompt_tokens_cache: 0,
          params: SLOT_PARAMS,
          next_token: [
            {
              has_next_token: true,
              has_new_line: false,
              n_remain: -1,
              n_decoded: 1000 + slotCalls * 50,
            },
          ],
        },
      ];
    });

    settingsStore.set({ baseUrl: BASE, pollMs: POLL_MS });
  });

  afterEach(() => {
    dashboard.stop();
    setHidden(false);
    vi.useRealTimers();
  });

  it('computes the live rate on every tick, not just the second', async () => {
    dashboard.start();

    // tick 1: immediate; no previous sample yet
    await vi.advanceTimersByTimeAsync(50);
    expect(dashboard.get().status).toBe('ok');
    expect(dashboard.get().lastTick?.derived?.liveGenTokS).toBeNull();

    // tick 2 (2 s later): delta 50 tokens / 2 s
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(dashboard.get().lastTick?.derived?.liveGenTokS).toBeCloseTo(25, 5);
    // prompt processed counter didn't move → no countable delta
    expect(dashboard.get().lastTick?.derived?.livePromptTokS).toBeNull();
    // prefill rate = Δprompt tokens / Δprompt seconds (250 / 0.25) — the
    // real prefill speed, independent of the poll interval
    expect(dashboard.get().lastTick?.derived?.promptPrefillTokS).toBeCloseTo(1000, 5);

    // tick 3: regression check — without this.prevSlots being updated the
    // rate is null here (prev stays the stale seed)
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(dashboard.get().lastTick?.derived?.liveGenTokS).toBeCloseTo(25, 5);
    expect(dashboard.get().lastTick?.derived?.promptPrefillTokS).toBeCloseTo(1000, 5);
  });

  it('does not fabricate wall-clock rates across a suspended-tab gap', async () => {
    dashboard.start();
    await vi.advanceTimersByTimeAsync(50); // tick 1
    await vi.advanceTimersByTimeAsync(POLL_MS); // tick 2: rates present
    expect(dashboard.get().lastTick?.derived?.liveGenTokS).toBeCloseTo(25, 5);

    // tab hidden: polling stops, wall clock keeps running for 30 min
    setHidden(true);
    await vi.advanceTimersByTimeAsync(30 * 60_000);

    // back to the tab: immediate tick, 30 min after the previous sample.
    // The slot counters DID advance (+50 tokens), so without the guard
    // this would persist 50/1800 = 0.03 tok/s as a measurement.
    setHidden(false);
    await vi.advanceTimersByTimeAsync(50);

    const d = dashboard.get().lastTick?.derived;
    expect(d?.liveGenTokS).toBeNull();
    expect(d?.genTokS).toBeNull();
    // ratio-style derivations divide two counter deltas, so they remain
    // valid over any gap and must NOT be suppressed
    expect(d?.promptPrefillTokS).toBeCloseTo(1000, 5);

    // and the next normal poll resumes rating
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(dashboard.get().lastTick?.derived?.liveGenTokS).toBeCloseTo(25, 5);
  });
});
