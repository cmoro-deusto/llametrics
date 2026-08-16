/**
 * In-memory view of persisted history for one server + window, kept in
 * sync with the live tick stream from the dashboard engine.
 */
import { useEffect, useRef, useState } from 'react';
import { dashboard } from '../lib/dashboard';
import { historyStore, type Tick } from '../lib/history';

export function useTicks(serverKey: string, windowMin: number): Tick[] {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const serverRef = useRef(serverKey);
  serverRef.current = serverKey;

  // (re)load when server or window changes
  useEffect(() => {
    let cancelled = false;
    if (!serverKey) {
      setTicks([]);
      return;
    }
    const from = Date.now() - windowMin * 60 * 1000;
    historyStore
      .query(serverKey, from)
      .then((t) => {
        if (!cancelled) setTicks(t);
      })
      .catch(() => {
        if (!cancelled) setTicks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [serverKey, windowMin]);

  // append live ticks as they arrive
  useEffect(() => {
    return dashboard.subscribe(() => {
      const s = dashboard.get();
      const tick = s.lastTick;
      if (!tick || tick.serverKey !== serverRef.current) return;
      setTicks((prev) => {
        if (prev.length && prev[prev.length - 1].t >= tick.t) return prev;
        const next = [...prev, tick];
        // drop points that fell out of the window
        const from = Date.now() - windowMin * 60 * 1000;
        return next.filter((t) => t.t >= from);
      });
    });
  }, [windowMin]);

  return ticks;
}
