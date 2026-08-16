/**
 * Persisted metric history in IndexedDB.
 *
 * Raw ticks are stored per server (keyed by normalized base URL) so every
 * saved endpoint keeps its own history. Retention is 7 days (age LRU on
 * write). Charts downsample in memory at read time.
 */

import type { SlotLiveSample } from './metrics';

export interface Tick {
  serverKey: string;
  /** epoch ms */
  t: number;
  /** instantaneous gauge values */
  gauges: Record<string, number>;
  /** cumulative counter values */
  counters: Record<string, number>;
  /** derived KPIs for the interval ending at this tick */
  derived: Record<string, number | null>;
  /** live per-slot counters (source for live throughput rates) */
  slots?: SlotLiveSample[];
}

const DB_NAME = 'llametrics';
const DB_VERSION = 1;
const STORE = 'ticks';
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TICKS = 500_000; // hard cap, oldest purged first

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['serverKey', 't'] });
        store.createIndex('byServer', 'serverKey');
        store.createIndex('byTime', 't');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('failed to open IndexedDB'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        t.oncomplete = () => {
          // resolve with the request result if it finished
          if (req && 'result' in req) resolve(req.result as T);
          else resolve(undefined as T);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      }),
  );
}

export const historyStore = {
  /** Append a tick and enforce retention (7 days) + hard cap. */
  async append(tick: Tick): Promise<void> {
    await tx('readwrite', (store) => {
      store.put(tick);
      const cutoff = Date.now() - RETENTION_MS;
      const purgeReq = store.index('byTime').openCursor(IDBKeyRange.upperBound(cutoff));
      purgeReq.onsuccess = () => {
        const cur = purgeReq.result;
        if (cur) {
          cur.delete();
          cur.continue();
        }
      };
    });
  },

  /** Ticks for a server in [fromMs, now], ascending by time. */
  async query(serverKey: string, fromMs: number): Promise<Tick[]> {
    const range = IDBKeyRange.bound(
      [serverKey, fromMs],
      [serverKey, Number.MAX_SAFE_INTEGER],
    );
    const ticks = await tx<Tick[]>('readonly', (store) => store.getAll(range));
    ticks.sort((a, b) => a.t - b.t);
    // trim to the hard cap (newest kept)
    return ticks.length > MAX_TICKS ? ticks.slice(ticks.length - MAX_TICKS) : ticks;
  },

  /** Newest tick for a server (used to seed derived-KPI deltas across reloads). */
  async last(serverKey: string): Promise<Tick | null> {
    const range = IDBKeyRange.bound(
      [serverKey, Number.MIN_SAFE_INTEGER],
      [serverKey, Number.MAX_SAFE_INTEGER],
    );
    return new Promise((resolve, reject) => {
      openDb()
        .then((db) => {
          const t = db.transaction(STORE, 'readonly');
          const store = t.objectStore(STORE);
          const req = store.openCursor(range, 'prev');
          req.onsuccess = () => {
            const cur = req.result;
            resolve(cur ? (cur.value as Tick) : null);
          };
          req.onerror = () => reject(req.error);
        })
        .catch(reject);
    });
  },

  async clearServer(serverKey: string): Promise<void> {
    await tx('readwrite', (store) => {
      // composite keyPath means we must cursor via the server index
      const req = store.index('byServer').openCursor(IDBKeyRange.only(serverKey));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          cur.delete();
          cur.continue();
        }
      };
    });
  },

  async clearAll(): Promise<void> {
    await tx('readwrite', (store) => {
      store.clear();
    });
  },

  /** Total stored tick count (for the settings panel). */
  async count(): Promise<number> {
    return tx<number>('readonly', (store) => store.count());
  },
};
