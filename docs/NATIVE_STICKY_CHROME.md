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

## Opaque document-reader chrome

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

## Required checks

`apps/app/e2e/native-chrome.spec.ts` must verify:

- transparent controls remain below a simulated safe area without duplicate padding;
- blur/grain covers the status bar and the full sticky element, with a masked lower edge;
- reader chrome starts at the viewport top, has an opaque fill, and pads controls below the safe area;
- reader controls hide on downward scroll and return on upward scroll;
- routes without transparent sticky chrome do not show the status-bar blur.
