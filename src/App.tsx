import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { settingsStore, useSettings } from './lib/settings';
import {
  dashboard,
  refreshDashboardSettings,
  startDashboard,
  useDashboard,
} from './lib/dashboard';
import { applyTheme } from './theme';
import { TopBar } from './components/TopBar';
import { SettingsModal } from './components/SettingsModal';
import { Onboard } from './components/Onboard';
import { SortableWidget } from './widgets/WidgetShell';
import { useActiveTicks, WIDGETS } from './widgets/registry';
import {
  computeLayout,
  computeMobileLayout,
  GAP,
  itemPx,
  ROW_H,
  type DragPin,
  type LayoutOverride,
  type Placed,
  type WidgetSize,
} from './lib/layout';

function Banner() {
  const dash = useDashboard();
  if (dash.status === 'ok' || dash.status === 'idle' || !dash.lastError) return null;
  return (
    <div className={`banner ${dash.status}`} role="alert">
      <b>{dash.status === 'stale' ? 'Stale data' : 'Server unreachable'}</b>
      <span>{dash.lastError}</span>
      <span className="muted" style={{ marginLeft: 'auto' }}>
        auto-retrying…
      </span>
    </div>
  );
}

function useMobileBreakpoint(): boolean {
  const [mobile, setMobile] = useState(
    () => window.matchMedia('(max-width: 600px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)');
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function App() {
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<DragPin | null>(null);
  const mobile = useMobileBreakpoint();
  const ticks = useActiveTicks(settings);

  // theme
  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  // engine lifecycle
  useEffect(() => {
    startDashboard();
    const unsub = settingsStore.subscribe(() => refreshDashboardSettings());
    return () => {
      unsub();
      dashboard.stop();
    };
  }, []);

  // close settings on Escape
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettingsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  // default sizes from the widget catalog
  const defaults = useMemo(() => {
    const d: Record<string, WidgetSize> = {};
    for (const [id, def] of Object.entries(WIDGETS)) d[id] = { w: def.meta.w, h: def.meta.h };
    return d;
  }, []);

  // visible widgets in display order (hidden ones free up their cells)
  const order = useMemo(
    () => settings.widgetOrder.filter((id) => WIDGETS[id] && !settings.widgetHidden[id]),
    [settings.widgetOrder, settings.widgetHidden],
  );

  const layout: Record<string, Placed> = useMemo(
    () =>
      mobile
        ? computeMobileLayout(order, defaults, settings.widgetLayout)
        : computeLayout(order, defaults, settings.widgetLayout, preview),
    [order, defaults, settings.widgetLayout, preview, mobile],
  );

  // board sizing (absolute item layout) — measured on the inner wrapper,
  // because absolutely positioned widgets are laid out from the padding
  // edge: padding on the board itself would NOT push them down
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardW, setBoardW] = useState(0);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoardW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings.baseUrl]);

  const rows = useMemo(
    () => Math.max(1, ...Object.values(layout).map((p) => p.y + p.h)),
    [layout],
  );
  const boardH = rows * (ROW_H + GAP) - GAP;

  const commitLayout = useCallback((pin: DragPin) => {
    const cur = settingsStore.get().widgetLayout;
    const next: LayoutOverride = { w: pin.w, h: pin.h, x: pin.x, y: pin.y };
    settingsStore.set({ widgetLayout: { ...cur, [pin.id]: next } });
  }, []);

  if (settings.baseUrl === '') {
    return (
      <>
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <Onboard />
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </>
    );
  }

  return (
    <>
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />
      <Banner />
      <main className="board">
        {/* the inner wrapper carries the spacing: absolute widgets anchor
            to its edges, so margin (not padding) is what moves them */}
        <div className="board-inner" ref={boardRef} style={{ height: boardH }}>
          {order.map((id) => {
          const pos = layout[id];
          if (!pos) return null;
          return (
            <SortableWidget
              key={id}
              id={id}
              pos={pos}
              px={itemPx(pos, boardW)}
              ticks={ticks}
              interactive={!mobile}
              isPreviewing={preview?.id === id}
              onPreview={setPreview}
              onCommit={commitLayout}
            />
          );
        })}
        </div>
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
