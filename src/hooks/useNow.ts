/**
 * Ticking clock for age readouts ("data 2m old").
 *
 * The dashboard state only changes when a poll lands, so a component that
 * renders an age from a stored timestamp would freeze at whatever it said
 * when the last poll arrived — which is exactly the case where the age
 * matters. This re-renders on its own, and stops while the tab is hidden
 * (like the polling engine) so a backgrounded dashboard costs nothing.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (timer === null) timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        stop();
      } else {
        setNow(Date.now());
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
  return now;
}
