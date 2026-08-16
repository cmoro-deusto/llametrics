// @vitest-environment node
/**
 * historyStore against a spec-compliant IndexedDB (fake-indexeddb).
 * This is the layer the browser charts load from — the only part of the
 * data pipeline that had no test coverage.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { RETENTION_MS, historyStore, type Tick } from '../history';

const KEY = 'http://10.0.0.57:9080';
const KEY2 = 'http://10.0.0.99:8080';

function tick(serverKey: string, t: number, extra?: Partial<Tick>): Tick {
  return {
    serverKey,
    t,
    gauges: { requests_processing: 0 },
    counters: { tokens_predicted_total: t },
    derived: { liveGenTokS: null },
    ...extra,
  };
}

describe('historyStore (IndexedDB)', () => {
  it('appends and queries per server, ascending', async () => {
    const now = Date.now();
    await historyStore.append(tick(KEY, now - 60_000));
    await historyStore.append(tick(KEY, now - 30_000));
    await historyStore.append(tick(KEY, now));
    await historyStore.append(tick(KEY2, now - 5_000));

    const res = await historyStore.query(KEY, now - 100_000);
    expect(res.map((t) => t.serverKey)).toEqual([KEY, KEY, KEY]);
    const ts = res.map((t) => t.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    // server 2's tick is not leaked into server 1's history
    expect(await historyStore.query(KEY2, now - 100_000)).toHaveLength(1);
  });

  it('query honors the from-boundary', async () => {
    const now = Date.now();
    const res = await historyStore.query(KEY, now - 45_000);
    // of the 3 KEY ticks (now-60s, now-30s, now) only 2 are inside 45s
    expect(res).toHaveLength(2);
  });

  it('last() returns the newest tick per server', async () => {
    const last1 = await historyStore.last(KEY);
    expect(last1?.t).toBe(Date.now() - 0 > 0 ? (await historyStore.query(KEY, 0)).at(-1)!.t : -1);
    const last2 = await historyStore.last(KEY2);
    expect(last2?.serverKey).toBe(KEY2);
    expect(await historyStore.last('http://unknown:9999')).toBeNull();
  });

  it('purges ticks older than the 7-day retention on append', async () => {
    const now = Date.now();
    const ancient = now - RETENTION_MS - 60_000;
    await historyStore.append(tick(KEY, ancient));
    // an append triggers the retention purge
    await historyStore.append(tick(KEY, now));
    const res = await historyStore.query(KEY, 0);
    expect(res.some((t) => t.t === ancient)).toBe(false);
    expect(res.some((t) => t.t === now)).toBe(true);
  });

  it('clearServer and clearAll', async () => {
    await historyStore.clearServer(KEY2);
    expect(await historyStore.query(KEY2, 0)).toHaveLength(0);
    expect((await historyStore.query(KEY, 0)).length).toBeGreaterThan(0);
    await historyStore.clearAll();
    expect(await historyStore.count()).toBe(0);
  });
});
