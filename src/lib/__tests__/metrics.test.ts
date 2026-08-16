import { describe, expect, it } from 'vitest';
import { COUNTERS, computeDerived, computeSinceStart, downsampleMinMax } from '../metrics';

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
