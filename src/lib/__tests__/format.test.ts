import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  formatRate,
} from '../format';

describe('formatBytes', () => {
  // decimal units: the label says GB, so the divisor must be 1000. The
  // 1024-based version printed "16.68 GB" for a 17.91 GB model.
  it('human-readable', () => {
    expect(formatBytes(17912397824)).toBe('17.9 GB');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1.00 KB');
    expect(formatBytes(1500)).toBe('1.50 KB');
    expect(formatBytes(123456789)).toBe('123 MB');
    expect(formatBytes(0)).toBe('0.00 B');
  });

  it('caps at the largest unit', () => {
    expect(formatBytes(5e15)).toBe('5.00 PB');
    // no EB in the list, so beyond PB it just keeps counting PB
    expect(formatBytes(5e18)).toBe('5000 PB');
  });

  it('raw', () => {
    expect(formatBytes(17912397824, 'raw')).toBe('17,912,397,824');
  });

  it('nullish', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });
});

describe('formatCount', () => {
  it('scales', () => {
    expect(formatCount(27320697856)).toBe('27.32B');
    expect(formatCount(248320)).toBe('248.3k');
    expect(formatCount(262144)).toBe('262.1k');
    expect(formatCount(999)).toBe('999');
  });

  it('raw', () => {
    expect(formatCount(27320697856, 'raw')).toBe('27,320,697,856');
  });
});

describe('formatRate', () => {
  it('scales and rounds', () => {
    expect(formatRate(136.865)).toBe('136.9');
    expect(formatRate(0.1234)).toBe('0.12');
    expect(formatRate(1234.5)).toBe('1.23k');
  });
  it('nullish', () => {
    expect(formatRate(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formats fractions as %', () => {
    expect(formatPercent(0.853)).toBe('85.3%');
    expect(formatPercent(1, 'raw')).toBe('100.000%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('distinguishes a missing counter from zero elapsed time', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats seconds', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3725)).toBe('1h 2m');
  });
});
