import { describe, expect, it } from 'vitest';
import { computeLayout, computeMobileLayout, GRID_COLS, type WidgetSize } from '../layout';

const defs: Record<string, WidgetSize> = {
  a: { w: 4, h: 2 },
  b: { w: 4, h: 2 },
  c: { w: 4, h: 2 },
  d: { w: 2, h: 2 },
  e: { w: 6, h: 4 },
};

describe('computeLayout', () => {
  it('flows unplaced widgets left-to-right, top-to-bottom', () => {
    const out = computeLayout(['a', 'b', 'c'], defs, {}, null);
    expect(out.a).toMatchObject({ x: 0, y: 0, w: 4, h: 2 });
    expect(out.b).toMatchObject({ x: 4, y: 0, w: 4, h: 2 });
    expect(out.c).toMatchObject({ x: 8, y: 0, w: 4, h: 2 });
  });

  it('wraps to the next row when the row is full', () => {
    const out = computeLayout(['a', 'b', 'c', 'd'], defs, {}, null);
    // a,b,c fill row 0 (12 cols); d (w=2) wraps to row 1
    expect(out.d).toMatchObject({ x: 0, y: 2 });
  });

  it('fills gaps left of wider widgets (dense flow)', () => {
    // e (w=6) first, then two w=4 widgets: a fits left of e, b below
    const out = computeLayout(['e', 'a', 'b'], defs, {}, null);
    expect(out.e).toMatchObject({ x: 0, y: 0, w: 6, h: 4 });
    expect(out.a).toMatchObject({ x: 6, y: 0, w: 4, h: 2 });
    expect(out.b).toMatchObject({ x: 6, y: 2, w: 4, h: 2 });
  });

  it('supports the user’s example: two 2x2 stacked, 2x4 beside both', () => {
    const d: Record<string, WidgetSize> = {
      one: { w: 2, h: 2 },
      two: { w: 2, h: 2 },
      side: { w: 2, h: 4 },
    };
    const overrides = {
      two: { w: 2, h: 2, x: 0, y: 2 },
      side: { w: 2, h: 4, x: 2, y: 0 },
    };
    const out = computeLayout(['one', 'two', 'side'], d, overrides, null);
    expect(out.one).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
    expect(out.two).toMatchObject({ x: 0, y: 2, w: 2, h: 2 });
    expect(out.side).toMatchObject({ x: 2, y: 0, w: 2, h: 4 });
    // compaction must not disturb a hole-free arrangement
  });

  it('compacts upward: dropping space above pulls items up', () => {
    const overrides = {
      a: { w: 4, h: 2, x: 0, y: 6 },
      b: { w: 4, h: 2, x: 4, y: 0 },
    };
    const out = computeLayout(['a', 'b'], defs, overrides, null);
    // a is pinned to x=0 but compacts up to row 0 (nothing above it)
    expect(out.a).toMatchObject({ x: 0, y: 0 });
    expect(out.b).toMatchObject({ x: 4, y: 0 });
  });

  it('keeps a pinned x while finding a free row', () => {
    const overrides = {
      c: { w: 4, h: 2, x: 8, y: 0 },
      a: { w: 4, h: 2, x: 0, y: 0 },
    };
    const out = computeLayout(['a', 'c'], defs, overrides, null);
    expect(out.a).toMatchObject({ x: 0, y: 0 });
    expect(out.c).toMatchObject({ x: 8, y: 0 });
    // c wants x=8 but a..: row 0 has a at 0-4; c fits at 8 on row 0
  });

  it('never lets two items overlap', () => {
    const out = computeLayout(['a', 'b', 'c', 'd', 'e'], defs, {}, null);
    const items = Object.values(out);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i];
        const B = items[j];
        const overlap =
          A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
        expect(overlap, `${A.id} overlaps ${B.id}`).toBe(false);
      }
    }
  });

  it('clamps sizes and positions to the grid', () => {
    const overrides = {
      a: { w: 99, h: -3, x: -5, y: 3 },
    };
    const out = computeLayout(['a'], defs, overrides, null);
    expect(out.a.w).toBe(GRID_COLS);
    expect(out.a.h).toBe(1);
    expect(out.a.x).toBe(0);
    expect(out.a.y).toBe(0); // compacts up
  });

  it('pins a live drag item exactly and packs the rest around it', () => {
    // drag a (4x2) to row 2; b and c must not overlap it and compact up
    const out = computeLayout(
      ['a', 'b', 'c'],
      defs,
      {},
      { id: 'a', x: 4, y: 4, w: 4, h: 2 },
    );
    expect(out.a).toMatchObject({ x: 4, y: 4, w: 4, h: 2 });
    // b flows at (0,0), c at (0,2)?? b is 4x2 at (0,0); c 4x2:
    // first free spot: (4,0) is taken by a? a is at (4,4) — (4,0) free
    expect(out.b).toMatchObject({ x: 0, y: 0 });
    expect(out.c).toMatchObject({ x: 4, y: 0 });
    // and nothing overlaps
    const items = Object.values(out);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        expect(
          A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h,
        ).toBe(false);
      }
  });

  it('resize preview: pinned w/h are used while packing', () => {
    // grow a to 8 wide while dragging it to the top-left corner
    const out = computeLayout(
      ['a', 'b', 'c'],
      defs,
      {},
      { id: 'a', x: 0, y: 0, w: 8, h: 2 },
    );
    expect(out.a).toMatchObject({ x: 0, y: 0, w: 8, h: 2 });
    // b (4x2) must sit right of a; c below b
    expect(out.b).toMatchObject({ x: 8, y: 0 });
    expect(out.c).toMatchObject({ x: 0, y: 2 });
  });

  it('skips hidden ids (absent from order)', () => {
    const out = computeLayout(['b', 'c'], defs, {}, null);
    expect(Object.keys(out).sort()).toEqual(['b', 'c']);
    expect(out.b).toMatchObject({ x: 0, y: 0 });
  });
});

describe('computeMobileLayout', () => {
  it('stacks everything full-width in display order', () => {
    const out = computeMobileLayout(['a', 'b', 'c'], defs, {});
    const ids = Object.keys(out);
    expect(ids).toHaveLength(3);
    let prevBottom = 0;
    for (const id of ['a', 'b', 'c']) {
      const p = out[id];
      expect(p.x).toBe(0);
      expect(p.w).toBe(GRID_COLS);
      expect(p.y).toBeGreaterThanOrEqual(prevBottom);
      prevBottom = p.y + 1; // gap row
    }
  });
});
