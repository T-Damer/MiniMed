# Native sticky chrome contract

MiniMed runs edge-to-edge on Android and iOS. The WebView content is drawn behind the native status
bar, so every top chrome surface must use exactly one of the two modes below.

## Transparent route chrome

Search controls and catalog/search toolbars use `.route-sticky-chrome--transparent` together with
`useStickySurface`; route-level toolbars also carry `.route-sticky-chrome` for shared hide/show
motion.

- Controls sit at `--sticky-header-top` (`--safe-top + 0.5rem`) and therefore never overlap status-bar
  icons.
- The feature must not add `--safe-top` again when `.sticky-surface--stuck` appears.
- While unstuck, no backdrop is visible.
- While stuck, a blur + grain layer is rendered behind the controls. It begins at the viewport top,
  covers the status-bar area and the complete sticky element, then fades to transparent below the
  element through a mask.
- The backdrop never contains interactive content, stays below the controls, and transitions through
  opacity rather than `display`.

The shared implementation is in `styles/mobile-shell.css`, `styles/modules.css`, and
`components/sticky-surface.ts`. Feature styles may define layout and ordinary padding, but not native
safe-area geometry.

## Hero header (owner 2026-10-28)

Every `Page` route passes a declared `hero` (`app/page-heroes.ts`); the patient diary's screens do
the same through `ScreenHeader` (inner screens get the plain band). Readers keep their own chrome. Implementation: `components/PageHero.tsx`, `components/PageHero.css`.

- A dark band (`--page-hero-band`, the bottom bar's colour) runs from the screen top and the surface
  edges under the header. `useHeroBleed` measures how far the header sits from its surface's edges
  and top (`--page-hero-inset-*`), so no route repeats safe-area geometry. The page is a flat sheet
  (`--page-hero-sheet`) whose rounded lip starts over the band's lower edge.
- The header is sticky with only its bottom strip on screen (`top` is CSS from the live
  `--safe-top`); its row (back, title, actions, «?») is natively sticky under the status bar. Native,
  not a scroll-linked transform: WebKit ran the transform a frame behind the sticky header and the
  row jumped. The room under the header's text is an element (`page__hero-room`), not padding: a
  sticky child may only travel within its parent's content box. Scroll-driven
  (`animation-timeline: scroll(root)`, cosmetic only): the description fades before the row reaches
  it, the band's art fades, and the emblem (drawn in the row, over the row's pinned fill) flies into a
  small icon just after the title, or fades where the row has no room. `useHeroScroll` measures on
  the header's resize and when the width or `--safe-top` changes — never during a scroll (a
  toolbar-collapse `resize` re-measured mid-scroll and the header flashed its end state) — writes
  only changed lengths, and always reads the unstuck box. Scroll-driven animations are never retimed
  by the motion setting. Pinned, the row is filled with the band's colour (Safari tints the status
  bar strip from it) and the band continues above the header to the screen top. A header without a
  row does not stick (nothing to tap). Without scroll-driven animations the header scrolls away.
- The band's lowest strip is open (`clip-path`), with only its two concave corners drawn: content
  scrolling under the bar stays visible down to the sheet's rounded top. The search home's band
  (its header does not shrink) keeps an opaque lip.
- The status bar text is light while a band is under it (`state/system-bars.ts`, native only; the
  installed web app's `black-translucent` is always light).
- The search home has its own sticky tools row: it takes the band (`page-hero--search`, the field
  straddling its edge) and «MiniMed» in the row's empty middle at rest. Scrolling, the row becomes
  the band's opaque bar (`search-mode-tools__bar`, row `--filled`) as soon as the field starts sliding
  under it, and the «Поиск» pill appears once the typing line is hidden (state classes, short
  fades); the bar replaces the status blur there.
- iOS Safari tints the status-bar strip only from an opaque fixed or sticky bar flush with the top
  edge, and gives up when an invisible fixed layer also lies over that edge (with the bottom bar
  present). Keep pinned rows flush (`top: var(--safe-top)`, gap as padding) and remove unused fixed
  overlays with `display: none`, not `opacity: 0`. With nothing pinned it uses the body's background
  colour, which is therefore the band's (the shell paints the desk).
- Every `Page` route has a hero (`app/page-heroes.ts`); readers keep their own chrome.
- Do not add a second pinned bar: the header's own row is the bar.

## WebView document-reader chrome

Official and personal document readers do not use backdrop blur.

- `.document-page__chrome.route-sticky-chrome--opaque` starts at `top: 0` and has an opaque
  background extending behind the status bar.
- Its internal top padding includes `--safe-top`, keeping buttons and breadcrumbs below status-bar
  icons.
- When reading and scrolling down, the top reader controls and bottom navigation move out of view.
- Scrolling up, or returning near the top, restores both controls.
- While reader controls are hidden, the document paper supplies the opaque status-bar fill and the sticky
  section-path line (`ReaderSectionPath`, the only sticky heading element since 2026-10-08) moves to
  the safe-area edge.
- Controls that float over the pages follow the same rule: the PDF page dock (`.pdf-viewer__dock`:
  page box and zoom) sits above the bottom navigation while it is shown and slides out with it
  (`html.app-chrome-hidden`). Inside a dialog (note attachment) there is no bottom navigation, so
  the dock stays at the dialog's bottom edge.
- A jump the reader makes by itself (find next/previous, go to page, a thumbnail, a restored
  position) is not the user scrolling on: the viewer calls `holdReaderChrome()`
  (`state/reader-chrome-hold.ts`, event `minimed:reader-chrome-hold`) and `use-root-navigation.ts`
  keeps the controls visible for that moment. The user's own scrolling still hides and reveals.

This behavior is controlled by `use-root-navigation.ts`, `.app-chrome-hidden`, and the reader styles.
Do not add blur to document readers and do not offset their whole header below `--safe-top`.

## Compose native chrome (user decisions, 2026-09-30)

Native Compose routes use `NativeChromeScaffold`. Android system-bar scrims are transparent; the
application draws the material beneath the status icons. This also applies to native source readers.

- No glass, no tint, no grain behind the controls (user decision 2026-10-01: the frosted strip
  felt huge). Controls float on their own shadows. Once the scene scrolls, only the status bar keeps
  a strip in the page colour, fading over 8 dp, so system icons never sit on text.
- Apply the measured header height as scroll-content padding, rather than padding the viewport.
  Source text must actually scroll behind the status bar. Apply the status inset once inside the
  controls, and the navigation inset once at the bottom.
- Reader controls use one compact row: a primary-colour Back button, a bounded title and the
  source menu. Full titles, editions, provenance, source saving and retry actions remain in the menu.
- Preserve downward-scroll hiding and upward-scroll revealing. When controls are hidden, the
  status-bar strip still renders the backdrop over the scrolling source.

The WebView reader contract above remains separate from the native Compose implementation.

## Required checks

`apps/app/e2e/native-chrome.spec.ts` must verify:

- transparent controls remain below a simulated safe area without duplicate padding;
- the WebView blur/grain covers the status bar and the full sticky element, with a masked lower edge
  (WebView only; native uses the opaque strip above);
- reader chrome starts at the viewport top, has an opaque fill, and pads controls below the safe area;
- reader controls hide on downward scroll and return on upward scroll (`pdf-viewer.spec.ts` checks
  the same for the PDF page dock, and that a go-to-page jump keeps the controls);
- routes without transparent sticky chrome do not show the status-bar blur.
