/**
 * Vitest setup: fills jsdom gaps used by the app (no-op under node env).
 * Runs before test-file module graphs load, which matters because uPlot
 * probes window.matchMedia at import time.
 */
if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof (globalThis as Record<string, unknown>).ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }

  if (typeof (globalThis as Record<string, unknown>).Path2D === 'undefined') {
    class Path2DStub {
      moveTo() {}
      lineTo() {}
      closePath() {}
      rect() {}
      arc() {}
      arcTo() {}
      ellipse() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
    }
    (globalThis as Record<string, unknown>).Path2D = Path2DStub;
  }

  // minimal 2D context: uPlot's canvas calls become no-ops
  const ctxStub = () =>
    new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'canvas') return { width: 300, height: 150, style: {} };
          if (prop === 'measureText') return () => ({ width: 10 });
          if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
          return () => {};
        },
        set: () => true,
      },
    );
  // @ts-expect-error jsdom stub
  HTMLCanvasElement.prototype.getContext = ctxStub;
}
