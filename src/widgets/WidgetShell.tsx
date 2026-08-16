/**
 * Freeform widget wrapper: absolutely positioned by the layout engine.
 * Pointer-driven move (drag handle in the header) and resize (right /
 * bottom / corner handles). While a pointer is down, the widget is
 * "pinned" at the preview position and the layout engine packs the
 * rest of the board around it; on release the final geometry is
 * persisted.
 */
import {
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { settingsStore, useSettings } from '../lib/settings';
import type { Tick } from '../lib/history';
import { WIDGETS } from './registry';
import { clamp, GAP, GRID_COLS, ROW_H, type DragPin, type Placed } from '../lib/layout';

type DragKind = 'move' | 'w' | 'h' | 'wh';

interface DragState {
  kind: DragKind;
  startX: number;
  startY: number;
  /** pointer offset from the board's top-left at drag start */
  grabDX: number;
  grabDY: number;
  orig: Placed;
}

export function SortableWidget({
  id,
  pos,
  px,
  ticks,
  interactive,
  isPreviewing,
  onPreview,
  onCommit,
}: {
  id: string;
  pos: Placed;
  px: { left: number; top: number; width: number; height: number };
  ticks: Tick[];
  interactive: boolean;
  isPreviewing: boolean;
  onPreview: (pin: DragPin | null) => void;
  onCommit: (pin: DragPin) => void;
}) {
  const settings = useSettings();
  const def = WIDGETS[id];
  const hidden = settings.widgetHidden[id];
  const dragRef = useRef<DragState | null>(null);
  const movedRef = useRef(false);
  const lastPinRef = useRef<DragPin | null>(null);
  const [activeHandle, setActiveHandle] = useState<DragKind | null>(null);

  const boardOf = (el: HTMLElement): HTMLElement | null => {
    // the inner wrapper: widgets are absolutely positioned relative to it
    const b = el.closest('.board-inner');
    return b instanceof HTMLElement ? b : null;
  };

  const startDrag =
    (kind: DragKind) => (e: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>) => {
      if (!interactive) return;
      const board = boardOf(e.currentTarget);
      if (!board) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = board.getBoundingClientRect();
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        grabDX: e.clientX - rect.left - pos.x * (colWOf(board) + GAP),
        grabDY: e.clientY - rect.top - pos.y * (ROW_H + GAP),
        orig: pos,
      };
      movedRef.current = false;
      lastPinRef.current = null;
      e.currentTarget.setPointerCapture(e.pointerId);
      setActiveHandle(kind);
    };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const board = boardOf(e.currentTarget);
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const colW = colWOf(board);
    const uX = colW + GAP;
    const uY = ROW_H + GAP;

    let pin: DragPin;
    if (d.kind === 'move') {
      const x = clamp(
        Math.round((e.clientX - rect.left - d.grabDX) / uX),
        0,
        GRID_COLS - d.orig.w,
      );
      const y = Math.max(0, Math.round((e.clientY - rect.top - d.grabDY) / uY));
      pin = { id, x, y, w: d.orig.w, h: d.orig.h };
    } else {
      const dx = (e.clientX - d.startX) / uX;
      const dy = (e.clientY - d.startY) / uY;
      const w =
        d.kind === 'w' || d.kind === 'wh'
          ? clamp(Math.round(d.orig.w + dx), 1, GRID_COLS - d.orig.x)
          : d.orig.w;
      const h =
        d.kind === 'h' || d.kind === 'wh'
          ? clamp(Math.round(d.orig.h + dy), 1, 48)
          : d.orig.h;
      pin = { id, x: d.orig.x, y: d.orig.y, w, h };
    }

    const last = lastPinRef.current;
    if (!last || last.x !== pin.x || last.y !== pin.y || last.w !== pin.w || last.h !== pin.h) {
      lastPinRef.current = pin;
      movedRef.current = true;
      onPreview(pin);
    }
  };

  const endDrag = (e: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setActiveHandle(null);
    const last = lastPinRef.current;
    if (movedRef.current && last) onCommit(last);
    onPreview(null);
  };

  if (!def || hidden) return null;

  const Body = def.render as unknown as ComponentType<{ ticks: Tick[] }>;
  const style: CSSProperties = { ...px, position: 'absolute' };

  const handleProps = (kind: DragKind) => ({
    onPointerDown: startDrag(kind),
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  return (
    <div
      className={`widget${isPreviewing ? ' dragging' : ''}`}
      style={style}
    >
      <div className="widget-head">
        <span className="widget-title">{def.meta.title}</span>
        <button
          className={`drag-handle${activeHandle === 'move' ? ' active' : ''}`}
          title="Drag to move"
          aria-label={`Move ${def.meta.title}`}
          {...handleProps('move')}
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
      <div className="widget-fill">
        <Body ticks={ticks} />
      </div>
      {interactive && (
        <>
          <div
            className={`rz rz-r${activeHandle === 'w' ? ' active' : ''}`}
            title="Drag to resize width"
            aria-label={`Resize width of ${def.meta.title}`}
            {...handleProps('w')}
          />
          <div
            className={`rz rz-b${activeHandle === 'h' ? ' active' : ''}`}
            title="Drag to resize height"
            aria-label={`Resize height of ${def.meta.title}`}
            {...handleProps('h')}
          />
          <div
            className={`rz rz-c${activeHandle === 'wh' ? ' active' : ''}`}
            title="Drag to resize"
            aria-label={`Resize ${def.meta.title}`}
            {...handleProps('wh')}
          />
        </>
      )}
    </div>
  );
}

function colWOf(board: HTMLElement): number {
  return (board.clientWidth - (GRID_COLS - 1) * GAP) / GRID_COLS;
}
