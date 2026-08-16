import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WIDGET_ORDER, sanitizeSettings } from '../settings';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(sanitizeSettings(undefined).baseUrl).toBe('');
    expect(sanitizeSettings(null).pollMs).toBe(2000);
    expect(sanitizeSettings(42).theme).toEqual({ mode: 'system', palette: 'default', accent: null });
  });

  it('clamps pollMs and chartWindowMin', () => {
    expect(sanitizeSettings({ pollMs: 10 }).pollMs).toBe(1000);
    expect(sanitizeSettings({ pollMs: 999999 }).pollMs).toBe(60000);
    expect(sanitizeSettings({ chartWindowMin: 0 }).chartWindowMin).toBe(1);
    expect(sanitizeSettings({ chartWindowMin: 1e9 }).chartWindowMin).toBe(4320);
  });

  it('validates theme fields', () => {
    expect(sanitizeSettings({ theme: { mode: 'bogus', palette: 'nope', accent: '#zzz' } }).theme).toEqual({
      mode: 'system',
      palette: 'default',
      accent: null,
    });
    expect(sanitizeSettings({ theme: { mode: 'dark', palette: 'ocean', accent: '#123abc' } }).theme).toEqual({
      mode: 'dark',
      palette: 'ocean',
      accent: '#123abc',
    });
  });

  it('drops unknown endpoints and keeps valid ones', () => {
    const out = sanitizeSettings({
      endpoints: [
        { id: '1', name: 'A', url: 'http://a' },
        { id: 2, name: 'bad' },
        'junk',
      ],
    });
    expect(out.endpoints).toEqual([{ id: '1', name: 'A', url: 'http://a' }]);
  });

  it('preserves widget order, appends newly added default widgets', () => {
    const out = sanitizeSettings({ widgetOrder: ['slots', 'models'] });
    // user-ordered widgets keep their relative order, rest appended
    expect(out.widgetOrder.slice(0, 2)).toEqual(['slots', 'models']);
    expect(out.widgetOrder).toContain('counters');
    expect(out.widgetOrder).toHaveLength(DEFAULT_WIDGET_ORDER.length);
  });

  it('defaults match the shipped catalog', () => {
    expect(DEFAULT_SETTINGS.widgetOrder).toEqual([...DEFAULT_WIDGET_ORDER]);
  });

  it('sanitizes widget layout overrides: clamps sizes/positions, drops junk', () => {
    const out = sanitizeSettings({
      widgetLayout: {
        'kpi:prompt-tok-s': { w: 5.4, h: -2, x: -3, y: 200 },
        'chart:tok-s': { w: 99, h: 0.6 },
        models: 'wide',
        slots: { junk: 1 },
      },
    });
    expect(out.widgetLayout).toEqual({
      'kpi:prompt-tok-s': { w: 5, h: 1, x: 0, y: 100 },
      'chart:tok-s': { w: 12, h: 1 },
    });
    expect(sanitizeSettings({}).widgetLayout).toEqual({});
  });

  it('migrates legacy column-only spans (widgetSpans) to layout entries', () => {
    const out = sanitizeSettings({ widgetSpans: { models: 6, slots: 'junk' } });
    expect(out.widgetLayout).toEqual({ models: { w: 6 } });
  });
});
