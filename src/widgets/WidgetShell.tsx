/**
 * Sortable widget wrapper. All hooks run unconditionally; the widget body
 * is a separate component that unmounts (not just hides) when toggled off,
 * which keeps hook order stable.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from 'react';
import { settingsStore, useSettings } from '../lib/settings';
import type { Tick } from '../lib/history';
import { WIDGETS } from './registry';

const GRID_GAP = 12; // must match .grid in styles.css

export function SortableWidget({ id, ticks }: { id: string; ticks: Tick[] }) {
  const settings = useSettings();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const def = WIDGETS[id];
  const hidden = settings.widgetHidden[id];
  // user-resized span (persisted) wins over the widget's default
  const span = settings.widgetSpans[id] ?? def.meta.span;
  const spanRef = useRef(span);
  spanRef.current = span;
  const resizeRef = useRef<{ startX: number; startSpan: number; unit: number } | null>(null);
  const [resizing, setResizing] = useState(false);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const grid = e.currentTarget.closest('.grid');
    if (!(grid instanceof HTMLElement)) return;
    e.preventDefault();
    // width gained per extra column, including the gap
    const unit = (grid.clientWidth - 11 * GRID_GAP) / 12 + GRID_GAP;
    resizeRef.current = { startX: e.clientX, startSpan: spanRef.current, unit };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  };

  const moveResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) return;
    const next = Math.min(12, Math.max(1, Math.round(r.startSpan + (e.clientX - r.startX) / r.unit)));
    if (next !== spanRef.current) {
      settingsStore.set({ widgetSpans: { ...settingsStore.get().widgetSpans, [id]: next } });
    }
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setResizing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  if (!def || hidden) return null;

  const Body = def.render as unknown as ComponentType<{ ticks: Tick[] }>;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      className={`widget span-${span}${isDragging ? ' dragging' : ''}`}
      style={style}
    >
      <div className="widget-head">
        <span className="widget-title">{def.meta.title}</span>
        <button
          className="drag-handle"
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          aria-label={`Reorder ${def.meta.title}`}
        >
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden>
            <circle cx="3" cy="2" r="1.4" />
            <circle cx="9" cy="2" r="1.4" />
            <circle cx="3" cy="7" r="1.4" />
            <circle cx="9" cy="7" r="1.4" />
            <circle cx="3" cy="12" r="1.4" />
            <circle cx="9" cy="12" r="1.4" />
          </svg>
        </button>
        <button
          className="hide-btn"
          title="Hide widget (re-enable in Settings)"
          aria-label={`Hide ${def.meta.title}`}
          onClick={() =>
            settingsStore.set({
              widgetHidden: { ...settings.widgetHidden, [id]: true },
            })
          }
        >
          ✕
        </button>
      </div>
      <div
        className={`resize-handle${resizing ? ' active' : ''}`}
        title="Drag to resize"
        aria-label={`Resize ${def.meta.title}`}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
      <Body ticks={ticks} />
    </div>
  );
}
