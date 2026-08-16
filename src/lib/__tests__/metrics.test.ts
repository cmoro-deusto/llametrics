import { describe, expect, it } from 'vitest';
import {
  COUNTERS,
  computeDerived,
  computeSinceStart,
  downsampleMinMax,
  liveSlotRate,
  rollingRate,
  type SlotLiveSample,
} from '../metrics';

const base = {
  [COUNTERS.promptTokens]: 1000,
  [COUNTERS.promptTokensCached]: 3000,
  [COUNTERS.promptSeconds]: 2,
  [COUNTERS.tokensPredicted]: 500,
  [COUNTERS.tokensPredictedSeconds]: 10,
  [COUNTERS.nDecode]: 50,
  [COUNTERS.nTokensMax]: 4096,
  [COUNTERS.specDraftTokens]: 100,
  [COUNTERS.specAcceptedTokens]: 60,
  [COUNTERS.specDrafts]: 20,
};

describe('computeDerived', () => {
  it('computes rates and hit rates over an interval', () => {
    const cur = {
      ...base,
      [COUNTERS.promptTokens]: 1040, // +40
      [COUNTERS.promptTokensCached]: 3060, // +60
      [COUNTERS.tokensPredicted]: 510, // +10 in 2s -> 5 tok/s
      [COUNTERS.specDraftTokens]: 110, // +10
      [COUNTERS.specAcceptedTokens]: 67, // +7 -> 0.7 accept
      [COUNTERS.specDrafts]: 23, // +3 -> (7+3)/3 = 3.33 tok/verif
    };
    const d = computeDerived(base, cur, 2);
    expect(d.genTokS.value).toBeCloseTo(5, 5); // 10 tokens / 2s
    expect(d.promptTokS.value).toBeCloseTo(20, 5); // 40 uncached tokens / 2s
  });

  it('prompt rate uses only uncached prompt tokens', () => {
    const cur = { ...base, [COUNTERS.promptTokens]: 1040 };
    const d = computeDerived(base, cur, 2);
    expect(d.promptTokS.value).toBeCloseTo(20, 5);
  });

  it('cache hit rate = cached / (prompt + cached)', () => {
    const cur = { ...base, [COUNTERS.promptTokens]: 1040, [COUNTERS.promptTokensCached]: 3060 };
    const d = computeDerived(base, cur, 2);
    expect(d.cacheHitRate.value).toBeCloseTo(60 / 100, 5);
  });

  it('spec rates', () => {
    const cur = {
      ...base,
      [COUNTERS.specDraftTokens]: 110,
      [COUNTERS.specAcceptedTokens]: 67,
      [COUNTERS.specDrafts]: 23,
    };
    const d = computeDerived(base, cur, 2);
    expect(d.specAcceptRate.value).toBeCloseTo(0.7, 5);
    expect(d.specTokensPerVerif.value).toBeCloseTo(10 / 3, 5);
  });

  it('detects counter reset (negative delta) and nulls the interval', () => {
    const cur = { ...base, [COUNTERS.tokensPredicted]: 5 }; // server restarted
    const d = computeDerived(base, cur, 2);
    expect(d.genTokS.value).toBeNull();
    expect(d.genTokS.reset).toBe(true);
  });

  it('returns nulls when dt is non-positive or data missing', () => {
    const d = computeDerived(base, base, 0);
    expect(d.genTokS.value).toBeNull();
    const d2 = computeDerived({}, {}, 2);
    expect(d2.genTokS.value).toBeNull();
  });

  it('null accept rate when no drafts were generated in the interval', () => {
    const d = computeDerived(base, { ...base, [COUNTERS.tokensPredicted]: 510 }, 2);
    expect(d.specAcceptRate.value).toBeNull();
    expect(d.cacheHitRate.value).toBeNull();
  });
});

describe('computeSinceStart', () => {
  it('averages over the counter lifetime', () => {
    const s = computeSinceStart(base);
    expect(s.genTokS).toBeCloseTo(500 / 10, 5);
    expect(s.promptTokS).toBeCloseTo(1000 / 2, 5);
    expect(s.cacheHitRate).toBeCloseTo(3000 / 4000, 5);
    expect(s.specTokensPerVerif).toBeCloseTo(80 / 20, 5);
  });

  it('handles empty counters', () => {
    const s = computeSinceStart({});
    expect(s.genTokS).toBeNull();
    expect(s.cacheHitRate).toBeNull();
    expect(s.specTokensPerVerif).toBeNull();
  });
});

describe('rollingRate', () => {
  const c = COUNTERS.tokensPredicted;
  const at = (s: number, v: number) => ({ t: s * 1000, counters: { [c]: v } });

  it('nulls on empty/single samples or missing counter', () => {
    expect(rollingRate([], c, 60000)).toBeNull();
    expect(rollingRate([at(0, 100)], c, 60000)).toBeNull();
    expect(rollingRate([{ t: 0, counters: {} }, { t: 1000, counters: {} }], c, 60000)).toBeNull();
  });

  it('rates over the oldest in-window sample to the newest', () => {
    const s = [at(0, 100), at(30, 130), at(60, 160)];
    // 60s window: from t=0 → 60 tokens / 60s
    expect(rollingRate(s, c, 60000)).toBeCloseTo(1, 5);
    // 30s window: from t=30 → 30 tokens / 30s
    expect(rollingRate(s, c, 30000)).toBeCloseTo(1, 5);
  });

  it('uses the whole history when it is shorter than the window', () => {
    const s = [at(0, 0), at(10, 50)];
    expect(rollingRate(s, c, 60000)).toBeCloseTo(5, 5);
  });

  it('nulls on counter reset inside the window', () => {
    const s = [at(0, 1000), at(10, 500)]; // restart
    expect(rollingRate(s, c, 60000)).toBeNull();
  });
});

describe('liveSlotRate', () => {
  const s = (
    id: number,
    processing: boolean,
    nDecoded: number,
    nPrompt: number,
  ): SlotLiveSample => ({ id, processing, nDecoded, nPromptProcessed: nPrompt });

  it('rates tokens decoded while the slot was already processing', () => {
    // 100 tokens in 2s on slot 0
    const prev = [s(0, true, 100, 50), s(1, false, 0, 0)];
    const cur = [s(0, true, 200, 60), s(1, false, 0, 0)];
    expect(liveSlotRate(prev, cur, 2, 'nDecoded')).toEqual({ rate: 50, active: true });
  });

  it('sums across concurrently processing slots', () => {
    const prev = [s(0, true, 100, 0), s(1, true, 10, 0)];
    const cur = [s(0, true, 200, 0), s(1, true, 26, 0)];
    expect(liveSlotRate(prev, cur, 2, 'nDecoded').rate).toBeCloseTo(58, 5); // 100+16 over 2s
  });

  it('skips slots that started mid-interval (stale baseline)', () => {
    const prev = [s(0, false, 0, 0)];
    const cur = [s(0, true, 50, 0)];
    expect(liveSlotRate(prev, cur, 2, 'nDecoded')).toEqual({ rate: null, active: true });
  });

  it('skips slots that finished mid-interval (no overcount)', () => {
    const prev = [s(0, true, 100, 0)];
    const cur = [s(0, false, 300, 0)];
    expect(liveSlotRate(prev, cur, 2, 'nDecoded').rate).toBeNull();
  });

  it('skips negative deltas (task switched mid-interval)', () => {
    const prev = [s(0, true, 900, 0)]; // late in task A
    const cur = [s(0, true, 5, 0)]; // early in task B
    expect(liveSlotRate(prev, cur, 2, 'nDecoded').rate).toBeNull();
  });

  it('reports prompt rate from n_prompt_tokens_processed', () => {
    const prev = [s(0, true, 0, 1000)];
    const cur = [s(0, true, 0, 1104)];
    expect(liveSlotRate(prev, cur, 2, 'nPromptProcessed').rate).toBeCloseTo(52, 5);
  });

  it('nulls on missing samples or non-positive dt', () => {
    expect(liveSlotRate(null, [s(0, true, 10, 0)], 2, 'nDecoded').rate).toBeNull();
    expect(liveSlotRate([s(0, true, 10, 0)], [s(0, true, 20, 0)], 0, 'nDecoded').rate).toBeNull();
    expect(liveSlotRate([], [], 2, 'nDecoded')).toEqual({ rate: null, active: false });
  });
});

describe('downsampleMinMax', () => {
  it('returns input when below target', () => {
    const pts: [number, number][] = [[1, 1], [2, 5], [3, 2]];
    expect(downsampleMinMax(pts, 10)).toEqual(pts);
  });

  it('preserves min and max within each bucket', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 100; i++) pts.push([i, i === 50 ? 1000 : 1]);
    const out = downsampleMinMax(pts, 10);
    expect(out.length).toBeLessThanOrEqual(20);
    const values = out.map(([, v]) => v);
    expect(values).toContain(1000); // spike kept
    expect(values).toContain(1);
  });

  it('keeps time ordering', () => {
    const pts: [number, number][] = Array.from({ length: 500 }, (_, i) => [i, Math.sin(i)]);
    const out = downsampleMinMax(pts, 50);
    for (let i = 1; i < out.length; i++) {
      expect(out[i][0]).toBeGreaterThanOrEqual(out[i - 1][0]);
    }
  });
});
