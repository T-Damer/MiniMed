# Knowledge graph performance and layout — 2026-09-27

Moved from `docs/CURRENT_STATE.md`. Measured with `scripts/measure-knowledge-graph.mjs` on an M2 Max; not measured on a phone.


- **«Карта связей» is an experimental module.** The search-bar and library entry points follow the
  experimental-modules setting reactively, like «Словарь».
- **Bounded default view.** The graph opens on at most 300 documents: the current search results
  plus documents sharing their areas, or an area-balanced sample of the scope. The card says
  «Показано N из M документов» (plural forms from the locale) and «Показать все» draws the whole
  scope (`knowledge-graph-model.ts`).
- **Layout off the main thread.** A module Web Worker (`knowledge-graph.worker.ts`) runs the force
  layout on typed arrays or, above 500 nodes, the static grid. Force layout: Barnes–Hut repulsion
  scaled by the target spacing (canvas area per node); links as ropes whose length grows with the
  square root of the hub's degree, primary area stronger than further areas, each end moving in
  inverse proportion to its degree; a weak pull to the node's primary-area centroid and pushes
  between group centroids; collisions on a uniform grid (r_i + r_j + 12 px gap) during the run and
  a projection pass once settled. Alpha cooling stops it by convergence or 600 iterations in 12 ms
  slices. The grid uses the same radii and gap, leaves room for the area label and puts areas in
  blocks two steps apart. The view fits the laid-out graph until the user pans or zooms.
- **Drawing.** One coalesced redraw per frame, off-screen culling, spatial-hash hit testing (not
  while a button is pressed). Static layouts paint nodes as one cached `Path2D` per fill colour and
  per outline width, valid while the viewport stays inside the cached region or once it holds every
  node; selected and hovered nodes are repainted on top. Labels are placed greedily (selected,
  hovered, then by degree) and skipped when they would overlap one already drawn.
- **Overlap** (share of nodes whose circle meets another, captured from the running app): ATC
  «Нервная система» 0 % → 0 %, «Все источники» sample of 300 28 % → 0 %, query «инсульт»
  neighbourhood 21.5 % → 0 %; the worker test asserts < 1 % of pairs and of nodes.
- **Measured** with `scripts/measure-knowledge-graph.mjs`, before (0.6.41) and after back to back,
  median of 3 runs, 1280×844. `--headed` opens a window on the main display (DPR 2, vsync and the
  frame-rate limit off) and reports frame time median/p95/worst plus the share of frames over
  8.3 ms (120 Hz) and 6.1 ms (165 Hz), counting only frames that redrew the graph. After: every
  scenario (default views of «Нормативные документы», ATC «Нервная система», «Клинические
  рекомендации», «Все источники»; «Показать все» for the ATC group and for all 20 040 sources) has
  pan and zoom p95 ≤ 3.6 ms and no frame over 6.1 ms; first frame 27–81 ms, force layout settled in
  250–420 ms, no main-thread long task. Draw time p95, pan/zoom: all 20 040 sources 7.1/8.2 ms →
  1.0/2.5 ms; «Все источники» default 8.3/10.1 ms (it drew every source) → 0.7/1.3 ms. The old
  build drew inside pointer handlers, so its frame interval on static graphs (17.4 ms) was the input
  rate, not render cost. Headless numbers (rAF capped at 60 Hz): «Все источники» first frame
  67 → 45 ms, longest task 61 ms → none, pan 21 → 59 FPS. The machine ran a VM at ~250 % CPU
  during the runs (load ≈ 8 on 12 cores). Not measured on a physical phone.
