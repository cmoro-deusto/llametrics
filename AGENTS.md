# Repository Guidelines

## Project Overview

**llametrics** is a modern, themeable web dashboard for llama-server metrics.
It is a **pure static SPA (no backend)**: the browser polls the target
llama-server's `/metrics`, `/models`, `/slots`, and `/health` endpoints
directly. It renders KPIs, time-series charts over 7 days of persisted
history (IndexedDB), model cards, and a live slot strip. Theming (light/dark
× 5 palettes × accent picker) is CSS custom properties end to end. The
package also ships a zero-dependency CLI (`bin/llametrics.mjs`) that serves
the built `dist/` locally. It is published on npm as **`@gondor/llametrics`**
(public) — `npm i -g @gondor/llametrics` installs the prebuilt CLI.

## Architecture & Data Flow

- **`src/lib/` is framework-free and unit-tested.** All logic that can be
  pure stays here:
  - `prometheus.ts` — Prometheus text-format parser (strips the `llamacpp:`
    prefix; splits flat vs labeled series, e.g. `spec_decode_…_per_pos`).
  - `metrics.ts` — metric-name registries (`COUNTERS`, `GAUGES`), derived-KPI
    math (restart-safe counter deltas, cache hit rate, spec accept rate),
    `computeSinceStart` lifetime averages, and the wall-clock rate bound
    (`maxRateGapMs`/`isRateableGap`). No downsampling lives here — chart
    binning is in `TrendChart`.
  - `api.ts` — REST types + fetchers for /metrics /models /slots /health;
    `buildModelCards` merges `models[]` (names) with `data[]` (numeric
    details) **by id only** — no positional fallback, an unmatched model
    gets nulls rather than a sibling's numbers; `fetchHealth` never throws
    and classifies the answer into `ok | loading | error | unreachable`
    (a non-200 body is information, not a failure); `normalizeBaseUrl`.
  - `settings.ts` — settings store (external store pattern,
    `useSyncExternalStore`), localStorage persistence, JSON export/import,
    `sanitizeSettings` validates/merges any loaded object.
  - `history.ts` — IndexedDB store: raw ticks keyed `[serverKey, t]`, 7-day
    retention purged on write, per-server query/clear.
  - `dashboard.ts` — the polling engine (singleton `DashboardEngine`):
    parallel `Promise.allSettled` fetch per tick, derived-KPI computation
    against the previous sample (seeded from IndexedDB after reload), tick
    persistence, exponential backoff (1 s → 30 s) on failure, pause while
    the tab is hidden. Exposes `useDashboard()`. Two invariants worth
    keeping: wall-clock rates are suppressed when the gap to the previous
    sample exceeds `isRateableGap` (a hidden tab or a history-seeded `prev`
    can be hours or days old — dividing by that fabricates a near-zero
    "measurement"), and `slotsStale`/`modelsStale` record that /slots or
    /models failed while /metrics succeeded, because the engine keeps the
    previous values and the panels must not present them as live.
  - `layout.ts` — RGL-style freeform grid (12 cols, fixed-height rows):
    `computeLayout`/`computeMobileLayout` place pinned drag items exactly,
    honor saved x/y, flow the rest, then vertical-compact. `ROW_H`/`GAP`
    constants must match `.board` in `styles.css`.
  - `id.ts` — `genId()` (crypto.randomUUID with a non-secure-context
    fallback; plain-http LAN has no `crypto.randomUUID`).
- **`src/theme.ts`** applies `data-mode`/`data-palette` + `--accent` to
  `<html>`; `useThemeVersion()` lets non-CSS consumers (uPlot) re-read
  resolved CSS variables on theme change.
- **`src/widgets/registry.tsx`** maps widget id → `{ meta, render }`. Each
  `render` is a **real React component** (rendered as `<Body/>`), not a
  plain render fn — hook calls inside belong to the widget component.
  `SortableWidget` (`WidgetShell.tsx`) wraps them with a **custom
  pointer-based** move/resize (drag handle + edge/corner handles); hidden
  widgets unmount. **Widget ids are persisted user data** (`widgetOrder`,
  `widgetLayout` in localStorage): renaming one silently drops the widget
  from an existing board, so change a widget's behaviour, title and default
  size in place instead — `chart:busy-slots` keeps its `chart:` prefix
  though it is now a KPI tile. Adding a *new* id is safe:
  `sanitizeSettings` appends unknown-but-default ids to a saved order.
- **Data flow**: settings (base URL, poll interval) → `DashboardEngine.tick`
  → parsed/indexed metrics + derived KPIs → `historyStore.append` +
  `useDashboard` state → widgets. Charts read history through `useTicks`
  (IndexedDB load + live append) and downsample to ~2× pixel width.

## Key Directories

- `.github/workflows/` — `publish.yml`: the npm publishing pipeline
  (tag → gate → OIDC publish; see **Release & Publishing**).
- `bin/` — the CLI (`llametrics.mjs`), no dependencies; serves `dist/`,
  injects a `window.__LLAMETRICS_PREFILL__` script into `index.html` when
  `--base-url` is given.
- `scripts/` — dev helpers: `mock-server.mjs` (fake llama-server on
  127.0.0.1:9211 with incrementing counters) and `cdp-probe.mjs` (headless
  Chrome CDP probe for manual browser-level verification).
- `src/lib/` — framework-free core (see above) + `src/lib/__fixtures__/`
  (live-server snapshots used as test fixtures).
- `src/lib/__tests__/` — unit tests for the core libs.
- `src/widgets/__tests__/`, `src/components/__tests__/` — jsdom tests for
  the React layer (chart data paths, slot rendering, server-rate chips,
  top-bar state/age).
- `src/__tests__/` — jsdom app smoke test (full render against mocked
  endpoints).
- `src/widgets/`, `src/components/`, `src/hooks/` — React layer.
  `useTicks` (history view), `useCssVars` (resolved theme colors),
  `useNow` (ticking clock for age readouts — dashboard state only changes
  when a poll lands, which is exactly when an age must keep moving).
- `src/test/setup.ts` — vitest setup: jsdom gap stubs (matchMedia,
  ResizeObserver, Path2D, canvas 2D context). Runs before test imports —
  uPlot probes `window.matchMedia` at module load.

## Development Commands

- `npm install` — install (Node ≥ 20; npm is canonical, `package-lock.json`)
- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — `tsc -b && vite build` → `dist/` (relative `base: './'`)
- `npm test` — vitest run (14 suites: lib unit tests + widget/component
  tests + app smoke)
- `npm run test:watch` — vitest watch
- `npm run typecheck` — `tsc -b --noEmit`
- `npm start` / `node bin/llametrics.mjs [--port 9100] [--host 127.0.0.1]
  [--base-url <url>] [--no-open] [--version]` — serve `dist/` locally
  (build first)
- `node scripts/mock-server.mjs` — fake llama-server for local/browser QA

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
- **uPlot**: update live ticks via `u.setData()`, **never `u.redraw()`**
  (breaks auto-ranging in 1.6.x); recreate the instance only on
  series/theme/size/emptiness change, not per tick.
- **Errors**: `ServerError` (api.ts) carries a `kind`
  (`network|http|parse`) and human-readable messages (the network kind
  includes the CORS hint).
- **Fixtures**: tests read live-server snapshots from
  `src/lib/__fixtures__/` (metrics-live.txt, models-live.json,
  slots-live.json); keep them representative of real llama.cpp output.

## Important Files

- `bin/llametrics.mjs` — CLI entry (also the npm `bin`).
- `src/main.tsx` — app bootstrap: CLI prefill handling, initial theme.
- `src/App.tsx` — engine lifecycle, freeform grid, settings modal wiring.
- `src/lib/dashboard.ts` — polling engine (the heart of the app).
- `src/lib/prometheus.ts`, `src/lib/metrics.ts` — parser + derived-KPI math
  (the most test-sensitive code).
- `src/widgets/registry.tsx` — widget catalog (ids must stay in sync with
  `DEFAULT_WIDGET_ORDER` in `src/lib/settings.ts`).
- `vite.config.ts` — build + vitest config (jsdom stubs via `setupFiles`).
- `.github/workflows/publish.yml` — npm publishing pipeline (see
  **Release & Publishing**).

## Runtime/Tooling Preferences

- **Node ≥ 20** (`engines` in package.json). npm + `package-lock.json` is
  the canonical toolchain; the package is Bun-compatible but not Bun-first.
- Vite 6 + `@vitejs/plugin-react`; uPlot 1.6 for charts; **custom
  pointer-based DnD** for widget layout (no `@dnd-kit` dependency). No CSS
  framework.
- No linter/formatter is configured; `tsc -b` (strict) is the static gate.
- Publish CI is pinned to **Node 24** — npm OIDC trusted publishing needs
  Node ≥ 22.14 / npm ≥ 11.5.1 (local dev is unchanged: Node ≥ 20).
- `@types/node` is an explicit devDependency (and `"node"` is in
  `tsconfig.app.json` `types`) because the tests use node: builtins — do not
  remove it; builds used to pass only where a sibling project's
  `node_modules/@types/node` leaked in via ancestor lookup.

## Testing & QA

- vitest (run via `npm test`). Suites: prometheus parser (against the live
  fixture), metrics math (deltas, resets, rate-gap bound), formatting,
  settings sanitization, api (model merge, health classification), engine
  wiring (live slot rate + suspended-tab gap, fake timers +
  fake-indexeddb), chart data paths (step expansion, bin modes, held
  disclosure), slot rendering, server-rate chips, top-bar state/age, and a
  jsdom **app smoke test** that renders the full App against mocked live
  endpoints — including the failure path (server 500 → stale/down status).
- There is no coverage tooling; the bar is: parser + math fully unit-tested,
  app smoke test green, manual QA against a real llama-server (the
  dashboard's base URL is user-configurable in the UI).
- When changing `prometheus.ts` or `metrics.ts`, extend the matching suite —
  both are pure and cheap to test.
- Tests that render components must call `cleanup()` in `afterEach`:
  vitest runs without `globals`, so React Testing Library's auto-cleanup
  is never registered and DOM from earlier cases leaks into later ones
  (symptom: "Found multiple elements with the role…").
- A regression test for a fabricated *value* should be checked by breaking
  the guard and watching it fail — several of these bugs produced
  plausible numbers, so a test that passes either way proves nothing.

## llama.cpp Metric Semantics (verified against upstream)

These cost real debugging to establish and are not guessable from the JSON
or the metric names. Re-check against `tools/server/` before changing any
display that depends on them.

- **`/metrics` gauges are scrape-consuming.** `prompt_tokens_seconds` and
  `predicted_tokens_seconds` come from a bucket that the /metrics handler
  itself resets (`server-context.cpp`: "the gauges are averaged over the
  window between two scrapes"). They are the only *server-timed* rates
  available — undiluted by idle wall clock — but they read 0 when nothing
  finished in the window, and a second Prometheus scraper splits the
  values with the dashboard. With speculative decoding
  `predicted_tokens_seconds` counts **decode steps**, not tokens, despite
  its HELP text; label it accordingly.
- **`n_busy_slots_per_decode` is a lifetime average**, not a live gauge:
  `n_busy_slots / n_decode` with both counters cumulative since server
  start (`server-task.cpp`). Never chart it as a trend.
- **Counters are credited when a task ENDS**, not per token. Any
  Δcounter/Δwall-clock rate therefore reads 0 during a generation and
  spikes on the tick a task completes. Live throughput must come from
  diffing `/slots` instead.
- **`/slots` reports the previous task on an idle slot.** Upstream
  serializes from `task ? task : task_prev` (`server_slot::to_json`), so
  `n_prompt_tokens`, `n_prompt_tokens_processed`, `n_prompt_tokens_cache`,
  `params` and `next_token.n_decoded` are *history* when
  `is_processing` is false — and are **absent entirely** on a slot that
  has never run a task (a fresh server returns only `id`, `n_ctx`,
  `speculative`, `is_processing`). This is why `liveSlotRate` only counts
  a slot that was processing in both samples.
- **`/models` `created` is `std::time(0)` at request time**, not a load
  timestamp. It advances on every poll. Do not display it as a time.
- **`/models` `status`** (`loaded`/`loading`/`sleeping`/`unloaded`/
  `downloading`/`downloaded`) exists only in multi-model router mode;
  single-model servers omit it.
- **A loading server 503s every endpoint**, not just /health
  (`server-http.cpp` `middleware_server_state`, body
  `{"error":{"message":"Loading model",…}}`). /health is the only way to
  tell "still starting" from "broken", which is why its state outranks the
  /metrics-derived status in the top bar.

## Release & Publishing

- **Package**: `@gondor/llametrics` (public npm, org `gondor`, account
  `gondorsolutions`). Install: `npm i -g @gondor/llametrics` → the
  `llametrics` CLI.
- **Publishing is tokenless (OIDC trusted publishing)** — and classic
  tokens are *disallowed* on the package (npmjs.com publishing access:
  "require 2FA and disallow tokens"). The only publish paths:
  1. **tag push** → `publish.yml` → npm OIDC (the normal path), or
  2. interactive `npm login` **with 2FA** as an account with package
     access (`gondorsolutions`, `dordoka`) — emergency escape hatch only.
  Never store an `NPM_TOKEN` in GitHub (or anywhere) for this package.
- **Release flow**:
  1. Bump the `package.json` version in a regular PR
     (`npm version X.Y.Z --no-git-tag-version`) → merge to `main`.
  2. On the merged `main` commit: `git tag -a vX.Y.Z -m "vX.Y.Z"` — the tag
     MUST equal the `package.json` version (the workflow fails fast
     otherwise).
  3. `git push origin vX.Y.Z` → `publish.yml` runs the full gate (`npm ci`
     → typecheck → test → build) → `npm publish` via OIDC. Provenance
     attestations are generated automatically (public repo + public
     package).
- **`publish.yml` ↔ npmjs.com trusted-publisher config must stay in
  sync** — all fields case-sensitive, and npm does NOT validate the form on
  save (an `ENEEDAUTH` at publish time = field mismatch). Current config:
  GitHub Actions · org/user `cmoro-deusto` · repo `llametrics` · workflow
  `publish.yml` · environment `npm-publish` · allowed action `npm publish`.
  The workflow: tag-only trigger (`v*`), `permissions: id-token: write`,
  GitHub environment `npm-publish`.
- **Publish-machine hygiene**: on any machine used for interactive
  (escape-hatch) publishes, only ever `git pull` + `npm ci` — never
  `npm install` (it rewrites the lockfile locally and blocks pulls).
- **npm ≥ 11.16/12 note**: `npm ci` warns that esbuild's postinstall is
  blocked by the new `allowScripts` default — harmless (the esbuild binary
  ships as an optionalDependency). If a CI build ever fails on a missing
  esbuild binary: `npm approve-scripts esbuild` + commit the resulting
  allowlist to package.json.

## Git & PR Workflow

- Commits: allowed. Always on a feature branch — **never commit directly to `main`**.
- Pushing and opening PRs: only with **explicit user consent** in the current session. Never assume or infer consent.
- Never merge a PR — not even when CI is green or the PR looks ready. Merging into `main` is always the user's action.
- Flow: create branch → commit → (with consent) push + open PR → watch CI → notify the user that the PR is ready to merge. Stop there.
- Releases follow the **Release & Publishing** flow (version bump in a PR →
  tag the merged commit → push tag); the publish workflow is the only
  automated pipeline in this repo.
