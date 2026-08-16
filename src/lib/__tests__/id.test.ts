import { afterEach, describe, expect, it, vi } from 'vitest';
import { genId } from '../id';

describe('genId', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when available', () => {
    // node 22 + jsdom secure contexts provide randomUUID
    expect(genId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('falls back to a prefixed id when randomUUID is missing (insecure context)', () => {
    // simulate a non-secure context: crypto without randomUUID
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a });
    const id = genId('ep');
    expect(id).toMatch(/^ep-[0-9a-z]+-[0-9a-z]{8}$/);
  });

  it('produces unique ids on rapid succession (fallback path)', () => {
    vi.stubGlobal('crypto', {});
    const ids = new Set(Array.from({ length: 200 }, () => genId('ep')));
    expect(ids.size).toBeGreaterThan(190);
    void originalCrypto;
  });
});
