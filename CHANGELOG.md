# Changelog

Notable changes to llametrics, for the people using the dashboard. Dates are
in ISO format. Versions follow [semantic versioning](https://semver.org).

## Unreleased (0.1.2)

An accuracy pass over everything the dashboard displays. Every metric was
re-checked against the llama.cpp server source: several numbers looked
plausible but didn't mean what their label said, and a few things the server
tells us were being collected and then thrown away.

### Added

- **A server that's still loading its model now says so.** llama-server
  refuses *every* endpoint with a 503 until the model is up, so the dashboard
  used to report a bare `/metrics returned HTTP 503` and look broken. The
  status now reads **loading model…** with an explanation that nothing will
  answer until loading finishes.

- **Model cards show the model's state** — `loaded`, `loading`, `sleeping`,
  `unloaded`, `downloading` — when you're running llama-server's multi-model
  router. Single-model servers don't report this, and show no chip.

- **Both throughput cards now show llama-server's own measurement** next to
  the dashboard's, as a `server 82 tok/s` chip. This one is timed by the
  server over the window since the last poll, so unlike a token-count
  difference it isn't diluted by idle time. Hover it for the caveats: it
  reads 0 when nothing finished in the window, and it's labelled `steps/s`
  instead of `tok/s` when speculative decoding is on, because that's what
  the server actually counts there.

- **Charts now tell you when they're summarising.** Over a wide window there
  are more samples than pixels, so points get combined — and that quietly
  changed what the line meant. A caption now states the span each point
  covers, throughput and request charts keep the **peak** of each span so
  short bursts survive, and percentages keep the **last** value so they
  aren't biased upward. Requests-in-flight in particular used to lose
  single-poll spikes entirely at wide windows.

- **Held values are marked in chart tooltips.** A cache hit rate measured
  from one prompt an hour ago drew exactly the same flat line as continuous
  activity. Hovering such a point now shows **"held from HH:MM:SS"**.

- **The age of the data is shown** once it falls behind the poll interval, so
  a frozen dashboard no longer looks like a live one. Panels whose endpoint
  stopped answering (`/slots`, `/models`) now say they're frozen at the last
  reply instead of silently showing old values under a green *live* badge.

### Fixed

- **Model sizes were understated by about 7%.** Sizes were divided by 1024
  but labelled KB/MB/GB, so a 17.91 GB model displayed as `16.68 GB`. They're
  now decimal, matching the labels.

- **Fixed a crash when expanding a slot on a freshly started server.** A slot
  that hadn't served a request yet had no sampling parameters to show, and
  clicking to expand it broke the panel.

- **"prompt time" and "generation time" no longer claim `0s`** when the
  server doesn't report those counters at all — they show `—`, like every
  other unknown value.

- **Model cards no longer show a bogus "loaded" time.** The timestamp
  llama.cpp reports for a model is generated when the dashboard asks for it,
  not when the model was loaded — so the line was really just showing the
  current time, ticking forward on every poll. It's gone.

- **Model cards can no longer show another model's specs.** If you run more
  than one model and one of them wasn't described in the server's model list,
  its card silently borrowed the *first* model's size, parameter count,
  context length and quantization. Unknown values now show `—` instead.

- **The top bar no longer names your dashboard after an arbitrary model.**
  With several models loaded it picked whichever came first. It now shows the
  name only when a single model is loaded, and `N models` otherwise (hover for
  the full list).

- **Throughput is no longer invented after the tab wakes up.** Polling pauses
  while the dashboard is in a background tab, and history is kept for 7 days.
  On returning to the tab — or reloading after a while — the first reading
  divided real token counts by hours of elapsed time and recorded the
  near-zero result as if it were a genuine measurement, leaving a false dip in
  your charts. Rates are now left blank for that first reading and resume
  normally on the next poll. Cache hit rate, speculative accept rate and
  prompt prefill speed are unaffected, as they never depended on elapsed time.

- **The slot strip no longer shows a finished request as if it were running.**
  llama.cpp keeps reporting the last request's token counts on an idle slot,
  so a slot doing nothing displayed something like `prompt 52,084 (processed
  0)` — reading as a large prompt about to run. Idle slots now say
  `last task: …`, active slots show live progress, and slots that have never
  served a request say `no task yet`.

### Changed

- **"Session generation rate" is now "Avg generation (since start)".** The old
  tile measured generated tokens against wall-clock time, but the server only
  reports generated tokens once a request finishes — so the tile read `0.00`
  for the entire generation, then jumped to a figure several times your
  model's real speed for a single refresh, then dropped back. It now shows the
  server's own lifetime average: tokens generated divided by time actually
  spent generating. For live speed, use the **Generation throughput** tile,
  which reads per-slot progress as it happens.

- **"Busy slots per decode" is now a single figure instead of a chart.** The
  server reports this as an average over its entire uptime, so charting it
  over time was misleading — it looked like live concurrency but barely moved
  after a few hours of uptime. It's now a tile marked *since server start*.
  Your saved layout is preserved; the tile appears where the chart was and can
  be resized.

## 0.1.1 — 2026-08-16

- First npm release of the prebuilt CLI: `npm i -g @gondor/llametrics`.
