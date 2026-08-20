/**
 * Metric name registry + derived-KPI math for llama.cpp server metrics.
 *
 * Counters are cumulative since server start and reset to 0 on restart.
 * Gauges are instantaneous snapshots. All derived KPIs here are computed
 * from counter deltas between two consecutive samples and are therefore
 * restart-safe (a negative delta means the server restarted: the interval
 * is discarded rather than producing a bogus rate).
 */

export const COUNTERS = {
  promptTokens: 'prompt_tokens_total',
  promptTokensCached: 'prompt_tokens_cached_total',
  promptSeconds: 'prompt_seconds_total',
  tokensPredicted: 'tokens_predicted_total',
  tokensPredictedSeconds: 'tokens_predicted_seconds_total',
  nDecode: 'n_decode_total',
  nTokensMax: 'n_tokens_max',
  specDraftTokens: 'spec_decode_num_draft_tokens_total',
  specAcceptedTokens: 'spec_decode_num_accepted_tokens_total',
  specDrafts: 'spec_decode_num_drafts_total',
} as const;

export const GAUGES = {
  promptTokS: 'prompt_tokens_seconds',
  predictedTokS: 'predicted_tokens_seconds',
  requestsProcessing: 'requests_processing',
  requestsDeferred: 'requests_deferred',
  busySlotsPerDecode: 'n_busy_slots_per_decode',
} as const;

/** labeled counter: one series per draft position */
export const SPEC_PER_POS = 'spec_decode_num_accepted_tokens_per_pos_total';

export type CounterMap = Record<string, number | undefined>;

export interface IntervalResult<T> {
  value: T | null;
  /** true if any involved counter went backwards (server restart mid-interval) */
  reset: boolean;
}

function delta(prev: number | undefined, cur: number | undefined): { d: number; reset: boolean } | null {
  if (prev === undefined || cur === undefined || !Number.isFinite(prev) || !Number.isFinite(cur)) return null;
  const d = cur - prev;
  return { d, reset: d < 0 };
}

export interface DerivedKpis {
  /** generation tok/s over the sample interval */
  genTokS: IntervalResult<number>;
  /** prompt tok/s over the sample interval */
  promptTokS: IntervalResult<number>;
  /** prompt cache hit rate over the interval, 0..1 */
  cacheHitRate: IntervalResult<number>;
  /** speculative draft tokens accepted / drafted, 0..1 */
  specAcceptRate: IntervalResult<number>;
  /** avg accepted tokens per verification step: (accepted + drafts) / drafts */
  specTokensPerVerif: IntervalResult<number>;
  /**
   * True prompt-processing speed of the interval(s) in which prompt time
   * advanced: Δprompt_tokens_total / Δprompt_seconds_total (uncached
   * tokens). Unlike the interval-averaged rate, this is the actual
   * prefill tok/s the hardware ran at — it does not dilute short prompt
   * bursts across idle time.
   */
  promptPrefillTokS: IntervalResult<number>;
}

/**
 * Compute derived KPIs between two consecutive samples.
 * `dt` is the interval length in seconds.
 */
export function computeDerived(prev: CounterMap, cur: CounterMap, dt: number): DerivedKpis {
  const out: DerivedKpis = {
    genTokS: { value: null, reset: false },
    promptTokS: { value: null, reset: false },
    cacheHitRate: { value: null, reset: false },
    specAcceptRate: { value: null, reset: false },
    specTokensPerVerif: { value: null, reset: false },
    promptPrefillTokS: { value: null, reset: false },
  };
  if (!(dt > 0)) return out;

  const dpTok = delta(prev[COUNTERS.tokensPredicted], cur[COUNTERS.tokensPredicted]);
  const dPrTok = delta(prev[COUNTERS.promptTokens], cur[COUNTERS.promptTokens]);
  const dPrSec = delta(prev[COUNTERS.promptSeconds], cur[COUNTERS.promptSeconds]);
  const dCached = delta(prev[COUNTERS.promptTokensCached], cur[COUNTERS.promptTokensCached]);
  const dDraft = delta(prev[COUNTERS.specDraftTokens], cur[COUNTERS.specDraftTokens]);
  const dAcc = delta(prev[COUNTERS.specAcceptedTokens], cur[COUNTERS.specAcceptedTokens]);
  const dVerif = delta(prev[COUNTERS.specDrafts], cur[COUNTERS.specDrafts]);

  if (dpTok) {
    if (dpTok.reset) out.genTokS.reset = true;
    else out.genTokS.value = dpTok.d / dt;
  }
  if (dPrTok) {
    if (dPrTok.reset) out.promptTokS.reset = true;
    else out.promptTokS.value = dPrTok.d / dt;
  }
  // prompt_seconds_total advances only while non-cached prompt tokens are
  // decoded, so dividing both deltas gives the real prefill rate of the
  // task(s) that finished inside the interval (the server's own
  // prompt_tokens_seconds gauge uses the same ratio)
  if (dPrTok && dPrSec) {
    const reset = dPrTok.reset || dPrSec.reset;
    if (reset) out.promptPrefillTokS.reset = true;
    else if (dPrSec.d > 0) out.promptPrefillTokS.value = dPrTok.d / dPrSec.d;
  }
  if (dPrTok && dCached) {
    const reset = dPrTok.reset || dCached.reset;
    if (!reset) {
      const total = dPrTok.d + dCached.d;
      out.cacheHitRate.value = total > 0 ? dCached.d / total : null;
    } else {
      out.cacheHitRate.reset = true;
    }
  }
  if (dDraft && dAcc) {
    const reset = dDraft.reset || dAcc.reset;
    if (!reset) {
      out.specAcceptRate.value = dDraft.d > 0 ? dAcc.d / dDraft.d : null;
    } else {
      out.specAcceptRate.reset = true;
    }
  }
  if (dAcc && dVerif) {
    const reset = dAcc.reset || dVerif.reset;
    if (!reset) {
      out.specTokensPerVerif.value = dVerif.d > 0 ? (dAcc.d + dVerif.d) / dVerif.d : null;
    } else {
      out.specTokensPerVerif.reset = true;
    }
  }
  return out;
}

export interface SinceStartStats {
  /** average generation tok/s since server start */
  genTokS: number | null;
  /** average prompt tok/s since server start */
  promptTokS: number | null;
  /** prompt cache hit rate since server start, 0..1 */
  cacheHitRate: number | null;
  /** avg accepted tokens per verification step since server start */
  specTokensPerVerif: number | null;
}

/** Averages over the whole counter lifetime (since server start). */
export function computeSinceStart(cur: CounterMap): SinceStartStats {
  const avg = (numName: string, secName: string): number | null => {
    const num = cur[numName];
    const sec = cur[secName];
    return num !== undefined && sec !== undefined && sec > 0 ? num / sec : null;
  };
  const genTokS = avg(COUNTERS.tokensPredicted, COUNTERS.tokensPredictedSeconds);
  const promptTokS = avg(COUNTERS.promptTokens, COUNTERS.promptSeconds);
  const prompt = cur[COUNTERS.promptTokens] ?? 0;
  const cached = cur[COUNTERS.promptTokensCached] ?? 0;
  const cacheHitRate = prompt + cached > 0 ? cached / (prompt + cached) : null;
  const verif = cur[COUNTERS.specDrafts] ?? 0;
  const acc = cur[COUNTERS.specAcceptedTokens] ?? 0;
  const specTokensPerVerif = verif > 0 ? (acc + verif) / verif : null;
  return { genTokS, promptTokS, cacheHitRate, specTokensPerVerif };
}

/**
 * Live per-slot sample taken from one /slots scrape. The /metrics
 * generation counters are only fed when a task ENDS (slot reset), so the
 * only "as it happens" throughput available over HTTP is diffing these
 * live counters between scrapes — the same numbers the server's log
 * prints as tg / tg_3s.
 */
export interface SlotLiveSample {
  id: number;
  processing: boolean;
  nDecoded: number;
  nPromptProcessed: number;
}

export interface LiveRateResult {
  /** tokens/s over the sample interval, or null when no countable delta */
  rate: number | null;
  /** true when at least one slot is processing in the current sample */
  active: boolean;
}

/**
 * Live rate (tokens/s) from consecutive /slots scrapes. A slot only
 * contributes when it was ALREADY processing in the previous sample —
 * otherwise its counter is stale from the last task, or a new task
 * started mid-interval (both would produce a bogus rate). Negative
 * deltas (task switched mid-interval) are skipped.
 */
export function liveSlotRate(
  prev: SlotLiveSample[] | null,
  cur: SlotLiveSample[] | null,
  dt: number,
  field: 'nDecoded' | 'nPromptProcessed',
): LiveRateResult {
  const active = !!cur && cur.some((s) => s.processing);
  if (!prev || !cur || !(dt > 0)) return { rate: null, active };
  const prevById = new Map(prev.map((s) => [s.id, s]));
  let tokens = 0;
  for (const s of cur) {
    if (!s.processing) continue;
    const p = prevById.get(s.id);
    if (!p || !p.processing) continue;
    const d = s[field] - p[field];
    if (d < 0) continue; // task switched mid-interval
    tokens += d;
  }
  return { rate: tokens > 0 ? tokens / dt : null, active };
}

/**
 * Longest gap between two samples that still yields a meaningful
 * wall-clock rate, given the configured poll interval.
 *
 * Polling pauses while the tab is hidden, backs off to 30 s while the
 * server is unreachable, and `prev` can be seeded from IndexedDB (7-day
 * retention) after a reload — so the gap between two consecutive samples
 * is not bounded by the poll interval. Dividing a real counter delta by
 * hours of wall clock produces a near-zero "rate" that is indistinguishable
 * from a measurement once persisted, so anything beyond this bound is
 * reported as unknown instead.
 *
 * 10 polls (min 60 s) absorbs a slow tick or a short backoff streak while
 * still rejecting suspended-tab and reload gaps.
 */
export function maxRateGapMs(pollMs: number): number {
  return Math.max(60_000, 10 * pollMs);
}

/**
 * Whether a gap between two samples is short enough for wall-clock rates
 * (tokens per second of elapsed time). Ratio-style derivations —
 * cache hit rate, accept rate, Δtokens/Δseconds prefill — divide one
 * counter delta by another and stay valid over any gap.
 */
export function isRateableGap(gapMs: number, pollMs: number): boolean {
  return gapMs >= 0 && gapMs <= maxRateGapMs(pollMs);
}

/** A sample carrying cumulative counters, newest last. */
export interface RateSample {
  t: number;
  counters: Record<string, number | undefined>;
}

/**
 * Rolling rate (per second) of a cumulative counter over the last
 * `windowMs` of samples. Restart-safe: a negative delta (counter reset)
 * yields null rather than a bogus rate.
 */
export function rollingRate(
  samples: RateSample[],
  counter: string,
  windowMs: number,
): number | null {
  const n = samples.length;
  if (n < 2) return null;
  const last = samples[n - 1];
  const lastVal = last.counters[counter];
  if (lastVal === undefined || !Number.isFinite(lastVal)) return null;
  const cutoff = last.t - windowMs;
  // oldest sample with t >= cutoff — scan backwards so the cost is
  // proportional to the window, not to the (possibly huge) history
  let i = n - 1;
  while (i > 0 && samples[i - 1].t >= cutoff) i--;
  const firstVal = samples[i].counters[counter];
  if (firstVal === undefined || !Number.isFinite(firstVal)) return null;
  const dt = (last.t - samples[i].t) / 1000;
  if (!(dt > 0)) return null;
  const d = lastVal - firstVal;
  if (d < 0) return null; // server restarted within the window
  return d / dt;
}
