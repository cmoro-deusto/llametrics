/**
 * Freeform dashboard layout engine (RGL-style, "vertical compaction").
 *
 * The grid is GRID_COLS columns of fixed-height rows. Each widget has a
 * size (w x h in grid units) and, optionally, an explicit position
 * (x, y). Widgets without explicit positions flow in `order`, filling
 * the first free spot (left-to-right, top-to-bottom). Afterwards every
 * non-pinned item is compacted upward so no vertical holes remain —
 * this also means a dropped drag settles into the lowest possible
 * position, like react-grid-layout's default mode.
 *
 * `pinned` describes the item currently under a pointer drag: it is
 * placed exactly where the preview says and everything else packs
 * around it, giving live collision feedback while dragging.
 */

export const GRID_COLS = 12;
export const MAX_ROWS = 100;
/** row height and gap in px — must match .board in styles.css */
export const ROW_H = 84;
export const GAP = 12;

/** pixel geometry of a placed item inside the board (absolute layout). */
export function itemPx(
  p: Placed,
  boardW: number,
): { left: number; top: number; width: number; height: number } {
  const colW = boardW > 0 ? (boardW - (GRID_COLS - 1) * GAP) / GRID_COLS : 100;
  return {
    left: p.x * (colW + GAP),
    top: p.y * (ROW_H + GAP),
    width: p.w * colW + (p.w - 1) * GAP,
    height: p.h * ROW_H + (p.h - 1) * GAP,
  };
}

export interface WidgetSize {
  w: number;
  h: number;
}

/** persisted per-widget layout override (any key may be absent → default) */
export interface LayoutOverride {
  w?: number;
  h?: number;
  x?: number;
  y?: number;
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DragPin {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export function clampSpan(v: number, max = GRID_COLS): number {
  return Math.min(max, Math.max(1, Math.round(v)));
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function collides(
  rect: { x: number; y: number; w: number; h: number },
  placed: Placed[],
  skipId: string,
): boolean {
  return placed.some((p) => p.id !== skipId && overlaps(rect, p));
}

/** First free cell scanning top-to-bottom, left-to-right. */
function findSpot(
  w: number,
  h: number,
  placed: Placed[],
  skipId: string,
): { x: number; y: number } {
  let maxY = 0;
  for (const p of placed) if (p.id !== skipId && p.y + p.h > maxY) maxY = p.y + p.h;
  for (let y = 0; y <= Math.min(MAX_ROWS, maxY); y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      if (!collides({ x, y, w, h }, placed, skipId)) return { x, y };
    }
  }
  // grid is (pathologically) full: park below everything
  return { x: 0, y: maxY + 1 };
}

/** Lowest free y at a fixed x (used when a saved x is kept but y must move). */
function findRow(x: number, w: number, h: number, placed: Placed[], skipId: string): number {
  let maxY = 0;
  for (const p of placed) if (p.id !== skipId && p.y + p.h > maxY) maxY = p.y + p.h;
  for (let y = 0; y <= Math.min(MAX_ROWS, maxY); y++) {
    if (!collides({ x, y, w, h }, placed, skipId)) return y;
  }
  return maxY + 1;
}

/**
 * Compute final positions for all widgets.
 *
 * @param order      widget ids in display order (flow order for unplaced items)
 * @param defaults   per-widget default sizes
 * @param overrides  per-widget persisted overrides (w/h always, x/y when pinned)
 * @param pinned     the live drag preview item (placed exactly, others pack around it)
 */
export function computeLayout(
  order: string[],
  defaults: Record<string, WidgetSize>,
  overrides: Record<string, LayoutOverride>,
  pinned: DragPin | null,
): Record<string, Placed> {
  const placed: Placed[] = [];

  const sizeOf = (id: string): WidgetSize => {
    const ov = overrides[id];
    const def = defaults[id] ?? { w: 4, h: 3 };
    return {
      w: clampSpan(ov?.w ?? def.w),
      h: Math.min(48, Math.max(1, Math.round(ov?.h ?? def.h))),
    };
  };

  const place = (id: string, x: number, y: number): Placed => {
    const { w, h } = sizeOf(id);
    const p: Placed = {
      id,
      x: Math.min(GRID_COLS - w, Math.max(0, Math.round(x))),
      y: Math.max(0, Math.round(y)),
      w,
      h,
    };
    placed.push(p);
    return p;
  };

  // 1. the live drag item is exactly where the preview says (its
  //    w/h are the live resize-preview values, not yet persisted)
  if (pinned) {
    const w = clampSpan(pinned.w);
    const h = Math.min(48, Math.max(1, Math.round(pinned.h)));
    placed.push({
      id: pinned.id,
      x: Math.min(GRID_COLS - w, Math.max(0, Math.round(pinned.x))),
      y: Math.max(0, Math.round(pinned.y)),
      w,
      h,
    });
  }

  // 2. every other widget, in display order
  for (const id of order) {
    if (pinned && id === pinned.id) continue;
    const ov = overrides[id];
    if (ov && (ov.x !== undefined || ov.y !== undefined)) {
      // previously pinned: keep x, find the lowest free row at that x
      const { w, h } = sizeOf(id);
      const x = Math.min(GRID_COLS - w, Math.max(0, Math.round(ov.x ?? 0)));
      place(id, x, findRow(x, w, h, placed, id));
    } else {
      const { w, h } = sizeOf(id);
      const spot = findSpot(w, h, placed, id);
      place(id, spot.x, spot.y);
    }
  }

  // 3. vertical compaction: pull everything (except the live drag item)
  //    up as far as it goes
  const byY = [...placed].sort(
    (a, b) => a.y - b.y || a.x - b.x || order.indexOf(a.id) - order.indexOf(b.id),
  );
  for (const p of byY) {
    if (pinned && p.id === pinned.id) continue;
    while (p.y > 0 && !collides({ ...p, y: p.y - 1 }, placed, p.id)) {
      p.y -= 1;
    }
  }

  const out: Record<string, Placed> = {};
  for (const p of placed) out[p.id] = { ...p };
  return out;
}

/** Single-column stacking for narrow screens (mobile fallback). */
export function computeMobileLayout(
  order: string[],
  defaults: Record<string, WidgetSize>,
  overrides: Record<string, LayoutOverride>,
): Record<string, Placed> {
  const out: Record<string, Placed> = {};
  let y = 0;
  for (const id of order) {
    const { h } = computeLayout([id], defaults, overrides, null)[id];
    out[id] = { id, x: 0, y, w: GRID_COLS, h };
    y += h + 1; // one empty row of breathing room between panels
  }
  return out;
}
