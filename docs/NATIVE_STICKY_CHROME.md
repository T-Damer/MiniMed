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

## WebView document-reader chrome

Official and personal document readers do not use backdrop blur.

- `.document-page__chrome.route-sticky-chrome--opaque` starts at `top: 0` and has an opaque
  background extending behind the status bar.
- Its internal top padding includes `--safe-top`, keeping buttons and breadcrumbs below status-bar
  icons.
- When reading and scrolling down, the top reader controls and bottom navigation move out of view.
- Scrolling up, or returning near the top, restores both controls.
- While reader controls are hidden, the document paper supplies the opaque status-bar fill and sticky
  document headings move to the safe-area edge.

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
- reader controls hide on downward scroll and return on upward scroll;
- routes without transparent sticky chrome do not show the status-bar blur.
