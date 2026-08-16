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
  };
  if (!(dt > 0)) return out;

  const dpTok = delta(prev[COUNTERS.tokensPredicted], cur[COUNTERS.tokensPredicted]);
  const dPrTok = delta(prev[COUNTERS.promptTokens], cur[COUNTERS.promptTokens]);
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

/**
 * Downsample points to ~`target` items using min/max buckets so chart
 * spikes are preserved. Points must be sorted by time ascending.
 */
export function downsampleMinMax(
  points: [number, number][],
  target: number,
): [number, number][] {
  if (points.length <= target) return points;
  const bucketSize = Math.ceil(points.length / target);
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i += bucketSize) {
    let minT = points[i][0], minV = points[i][1];
    let maxT = points[i][0], maxV = points[i][1];
    const end = Math.min(i + bucketSize, points.length);
    for (let j = i; j < end; j++) {
      const [t, v] = points[j];
      if (v < minV) [minT, minV] = [t, v];
      if (v > maxV) [maxT, maxV] = [t, v];
    }
    // emit in time order (min and max may occur in either order)
    if (minT === maxT) out.push([minT, minV]);
    else if (minT < maxT) out.push([minT, minV], [maxT, maxV]);
    else out.push([maxT, maxV], [minT, minV]);
  }
  return out;
}
