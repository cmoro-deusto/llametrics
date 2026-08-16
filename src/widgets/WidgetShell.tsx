/**
 * Sortable widget wrapper. All hooks run unconditionally; the widget body
 * is a separate component that unmounts (not just hides) when toggled off,
 * which keeps hook order stable.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ComponentType } from 'react';
import { settingsStore, useSettings } from '../lib/settings';
import type { Tick } from '../lib/history';
import { WIDGETS } from './registry';

export function SortableWidget({ id, ticks }: { id: string; ticks: Tick[] }) {
  const settings = useSettings();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const def = WIDGETS[id];
  const hidden = settings.widgetHidden[id];

  if (!def || hidden) return null;

  const Body = def.render as unknown as ComponentType<{ ticks: Tick[] }>;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      className={`widget span-${def.meta.span}${isDragging ? ' dragging' : ''}`}
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
      <Body ticks={ticks} />
    </div>
  );
}
