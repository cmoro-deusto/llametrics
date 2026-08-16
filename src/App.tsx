import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { useEffect, useState } from 'react';
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
import { useActiveTicks } from './widgets/registry';

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

export default function App() {
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const order = settingsStore.get().widgetOrder;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    settingsStore.set({ widgetOrder: arrayMove(order, from, to) });
  };

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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={settings.widgetOrder} strategy={rectSortingStrategy}>
          <main className="grid">
            {settings.widgetOrder.map((id) => (
              <SortableWidget key={id} id={id} ticks={ticks} />
            ))}
          </main>
        </SortableContext>
      </DndContext>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
