# Repository Guidelines

## Project Overview

**llametrics** is a modern, themeable web dashboard for llama-server metrics.
It is a **pure static SPA** (no backend): the browser polls the target
llama-server's `/metrics`, `/models`, `/slots`, and `/health` endpoints
directly. It renders KPIs, time-series charts over 7 days of persisted
history (IndexedDB), model cards, and a live slot strip. Theming (light/dark
× 5 palettes × accent picker) is CSS custom properties end to end. The
package also ships a zero-dependency CLI (`bin/llametrics.mjs`) that serves
the built `dist/` locally.

## Architecture & Data Flow

- **`src/lib/` is framework-free and unit-tested.** All logic that can be
  pure stays there:
  - `prometheus.ts` — Prometheus text-format parser (strips the `llamacpp:`
    prefix; splits flat vs labeled series, e.g. `spec_decode_…_per_pos`).
  - `metrics.ts` — metric-name registries (`COUNTERS`, `GAUGES`), derived-KPI
    math (restart-safe counter deltas, cache hit rate, spec accept rate),
    min/max downsampling.
  - `api.ts` — REST types + fetchers for /metrics /models /slots /health;
    `buildModelCards` merges `models[]` (names) with `data[]` (numeric
    details); `normalizeBaseUrl`.
  - `settings.ts` — settings store (external store pattern,
    `useSyncExternalStore`), localStorage persistence, JSON export/import,
    `sanitizeSettings` validates/merges any loaded object.
  - `history.ts` — IndexedDB store: raw ticks keyed `[serverKey, t]`, 7-day
    retention purged on write, per-server query/clear.
  - `dashboard.ts` — the polling engine (singleton `DashboardEngine`):
    parallel `Promise.allSettled` fetch per tick, derived-KPI computation
    against the previous sample (seeded from IndexedDB after reload), tick
    persistence, exponential backoff (1 s → 30 s) on failure, pause while
    the tab is hidden. Exposes `useDashboard()`.
- **`src/theme.ts`** applies `data-mode`/`data-palette` + `--accent` to
  `<html>`; `useThemeVersion()` lets non-CSS consumers (uPlot) re-read
  resolved CSS variables on theme change.
- **`src/widgets/registry.tsx`** maps widget id → `{ meta, render }`. Each
  `render` is a **real React component** (rendered as `<Body/>`), not a
  plain render fn — hook calls inside belong to the widget component.
  `SortableWidget` (dnd-kit) wraps them; hidden widgets unmount.
- **Data flow**: settings (base URL, poll interval) → `DashboardEngine.tick`
  → parsed/indexed metrics + derived KPIs → `historyStore.append` +
  `useDashboard` state → widgets. Charts read history through `useTicks`
  (IndexedDB load + live append) and downsample to ~2× pixel width.

## Key Directories

- `bin/` — the CLI (`llametrics.mjs`), no dependencies; serves `dist/`,
  injects a `window.__LLAMETRICS_PREFILL__` script into `index.html` when
  `--base-url` is given.
- `src/lib/` — framework-free core (see above) + `src/lib/__fixtures__/`
  (live-server snapshots used as test fixtures).
- `src/lib/__tests__/` — unit tests for the core libs.
- `src/__tests__/` — jsdom app smoke test (full render against mocked
  endpoints).
- `src/widgets/`, `src/components/`, `src/hooks/` — React layer.
- `src/test/setup.ts` — vitest setup: jsdom gap stubs (matchMedia,
  ResizeObserver, Path2D, canvas 2D context). Runs before test imports —
  uPlot probes `window.matchMedia` at module load.

## Development Commands

- `npm install` — install (Node ≥ 20; npm is canonical, `package-lock.json`)
- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — `tsc -b && vite build` → `dist/` (relative `base: './'`)
- `npm test` — vitest run (all 6 suites)
- `npm run test:watch` — vitest watch
- `npm run typecheck` — `tsc -b --noEmit`
- `npm start` / `node bin/llametrics.mjs [--port 9100] [--host 127.0.0.1]
  [--base-url <url>] [--no-open] [--version]` — serve `dist/` locally
  (build first)

## Code Conventions & Common Patterns

- **Strict TypeScript everywhere** (`tsconfig.app.json`: strict,
  noUnusedLocals/Parameters). No `any` without a comment; `@ts-expect-error`
  only for deliberate jsdom stubs.
- **External-store pattern for state**: plain modules with
  `get`/`subscribe`/`set` + `useSyncExternalStore` hooks (`settings.ts`,
  `dashboard.ts`). Class-based stores must use **arrow function fields** for
  `get`/`subscribe` — they are passed bare to `useSyncExternalStore` and
  would otherwise lose `this`.
- **React**: function components + hooks only (React 19); no state library.
  Widget `render` entries in the registry are components receiving a
  `{ ticks }` props object.
- **Async**: `Promise.allSettled` for the per-tick endpoint fan-out (one
  failing endpoint must not block the others); history calls are fire-and-
  forget with `.catch` (IndexedDB can be unavailable — the app degrades,
  it must not crash).
- **Formatting**: `src/lib/format.ts` is the single place for number
  formatting (human vs raw per user setting); components never format
  numbers ad hoc.
- **Styling**: plain CSS with custom properties (`src/styles.css`); theme
  colors only via `var(--…)`; uPlot reads resolved colors through
  `useCssVars` and re-renders on `useThemeVersion()`.
- **Errors**: `ServerError` (api.ts) carries a `kind`
  (`network|http|parse`) and human-readable messages (the network kind
  includes the CORS hint).
- **Fixtures**: tests read live-server snapshots from
  `src/lib/__fixtures__/` (metrics-live.txt, models-live.json,
  slots-live.json); keep them representative of real llama.cpp output.

## Important Files

- `bin/llametrics.mjs` — CLI entry (also the npm `bin`).
- `src/main.tsx` — app bootstrap: CLI prefill handling, initial theme.
- `src/App.tsx` — engine lifecycle, DnD grid, settings modal wiring.
- `src/lib/dashboard.ts` — polling engine (the heart of the app).
- `src/lib/prometheus.ts`, `src/lib/metrics.ts` — parser + derived-KPI math
  (the most test-sensitive code).
- `src/widgets/registry.tsx` — widget catalog (ids must stay in sync with
  `DEFAULT_WIDGET_ORDER` in `src/lib/settings.ts`).
- `vite.config.ts` — build + vitest config (jsdom stubs via `setupFiles`).

## Runtime/Tooling Preferences

- **Node ≥ 20** (`engines` in package.json). npm + `package-lock.json` is
  the canonical toolchain; the package is Bun-compatible but not Bun-first.
- Vite 6 + `@vitejs/plugin-react`; uPlot 1.6 for charts; `@dnd-kit/*` for
  widget drag-and-drop. No CSS framework.
- No linter/formatter is configured; `tsc -b` (strict) is the static gate.

## Testing & QA

- vitest (run via `npm test`). Suites: prometheus parser (against the live
  fixture), metrics math (deltas, resets, downsampling), formatting,
  settings sanitization, api/model-merge, and a jsdom **app smoke test**
  that renders the full App against mocked live endpoints — including the
  failure path (server 500 → stale/down status).
- There is no coverage tooling; the bar is: parser + math fully unit-tested,
  app smoke test green, manual QA against a real llama-server (the
  dashboard's base URL is user-configurable in the UI).
- When changing `prometheus.ts` or `metrics.ts`, extend the matching suite —
  both are pure and cheap to test.

## Git & PR Workflow

- Commits: allowed. Always on a feature branch — **never commit directly to `main`**.
- Pushing and opening PRs: only with **explicit user consent** in the current session. Never assume or infer consent.
- Never merge a PR — not even when CI is green or the PR looks ready. Merging into `main` is always the user's action.
- Flow: create branch → commit → (with consent) push + open PR → watch CI → notify the user that the PR is ready to merge. Stop there.
