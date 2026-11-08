# Screen density metric (UI-BATCH3, 2026-11-08)

Owner 2026-11-08: «each screen should show as much as it can… if a screen can avoid scrolling, it must… set up a fullness/emptiness metric if possible». This note records what exists and what MiniMed measures (`apps/app/e2e/screen-density.ts`, `screen-density.spec.ts`).

## 1. What exists
| Metric | Measures | Evidence | Tooling |
|---|---|---|---|
| Feature Congestion (Rosenholtz et al.) | Local variability of colour, luminance contrast, orientation; clutter = volume of the feature covariance ellipsoid | Validated against visual-search times and map-clutter rankings ([JoV 2007](https://dspace.mit.edu/handle/1721.1/37593); CHI 2005 maps) | MATLAB code from the MIT lab; needs image pipeline, not browser-native |
| Subband Entropy | Entropy of wavelet subbands; close to JPEG-compressed size | Same JoV 2007 paper; correlates with FC | MATLAB |
| Edge density | Share of edge pixels (Canny-like) | Same paper; also tracks search performance. A [2025 survey](https://arxiv.org/pdf/2510.08332) says later studies support FC, subband entropy and edge density | Trivial to implement |
| Miniukovich & De Angeli, "Quantification of interface visual complexity" (AVI 2014, [dblp](https://dblp.dagstuhl.de/pid/138/0855.html)) | Regression on clutter, colour variability, contour density, figure-ground contrast, white space | Explained up to ~51% of aesthetics and ~50% of complexity ratings (moderate, not strong) | See AIM |
| Reinecke & Gajos ([CHI 2014](https://eecs.harvard.edu/~kgajos/papers/2014/reinecke14visual.shtml); CHI 2013 first-impressions paper) | Colorfulness + visual complexity of web pages (about 2.4M ratings, 430 sites) | Strong dataset, but the finding is that the appeal optimum differs by age, gender, country, education. There is no universal threshold | Models published, not a maintained tool |
| Ngo, Teo, Byrne, "Modelling interface aesthetics" (Information Sciences 152, 2003, [overview](https://www.mi.sanu.ac.rs/vismath/ngo/index.html)) | 14 layout measures (balance, density, symmetry, unity, simplicity...). Density = covered share of the frame vs a target (~50% mentioned in secondary sources) | Fitted to a small set of layouts (mostly rated by experts). Weak evidence for modern UIs. the full text was not read, so the exact density formula is unverified | Formulas only |
| Aalto Interface Metrics, AIM ([paper](https://aaltodoc.aalto.fi/items/a5da620f-fcbc-4e88-b0f4-e4143fc7147f), [service](https://interfacemetrics.aalto.fi)) | 17 metrics from URL/screenshot: edge density, contour congestion, white space (share of page not covered by content), colour variability, FC, subband entropy, etc. | Inherits the validations above | Open-source codebase (Python/Node, headless-browser based); research-grade, heavy, not a pass/fail |

Big-company tools: none found. Lighthouse measures performance, a11y, CLS and unused CSS, not density or fill, and the search turned up no Google, Netflix, Airbnb or Meta tool for "above-the-fold fill" or layout density. Don't assume one exists. The closest public tools are AIM and the academic code.

Bottom line: the clutter metrics predict how hard it is to find something, and perceived complexity, in aggregate over many images. None gives a validated "too empty" threshold. All published work focuses on "too cluttered", and white space is treated as a plus. So the "too empty" and "too full" cut-offs below are heuristics and must be calibrated on MiniMed's own screens (run on all screens, look at the distribution, and set the cut-offs to the outliers you agree are bad).

## 2. What is practical in Playwright (<1 s)
- Feature Congestion / subband entropy: needs wavelet/MATLAB code. Skip. Reimplementing is unjustified.
- (b) Screenshot edge density: canvas Sobel over a 390x844 image is ~10-30 ms and works, but it measures texture, not occupancy. Dense plain text and a gradient photo both score high. A good secondary signal for "overloaded", poor for "empty".
- (c) Ngo density: it is just a covered-area ratio, i.e. (a) with a target. Taken as-is it adds nothing.
- (a) DOM filled share: cheap (few ms), deterministic, no pixel noise, directly answers "how much of the first viewport is used". **Recommended primary.**

### Recommended: content coverage on a coarse grid
Coverage = share of viewport cells touched by "ink": text line boxes, images/svg/canvas/video, form controls, and elements with a visible border or a background different from the page. Plain wrappers don't count. Use an 8 px grid and dilate each box by ~6 px, so tight gaps between lines count as filled and only real gaps count as empty.

Add two companion numbers, which matter more than the raw share:
1. `maxEmptyBand` = tallest full-width run of empty rows, as a fraction of the viewport. This catches a blank bottom half.
2. `bottomGap` = viewport height minus lowest ink, as a fraction.

Heuristic thresholds (uncalibrated; text-heavy pages naturally reach 0.35-0.55 because line boxes are mostly whitespace between glyphs):

| Viewport | too empty | ok | overloaded |
|---|---|---|---|
| Phone 390x844 | coverage < 0.30, or maxEmptyBand > 0.25 | 0.30-0.70 | > 0.80 and (small text < 12 px count > N, or > 12 distinct interactive targets) |
| Tablet 1024x768 | coverage < 0.25, or maxEmptyBand > 0.30 | 0.25-0.65 | > 0.75 |

Reasoning: tablet gets lower floors because wide viewports tolerate margins; phone gets higher ceilings because one column fills the width. "Overloaded" by area alone is rare (dilation inflates it), so add a hard guard: min font size < 12 px, tap targets < 44 px, or > ~12 controls in the first viewport. These are standard a11y/Fitts-style rules, easier to defend than a clutter number. An edge-density check (screenshot) can be added as an optional advisory only.

### Detecting "scrolls but is not a list"
- `scrolls = document.scrollingElement.scrollHeight > innerHeight + 4`, or any `overflow:auto|scroll` element with `scrollHeight > clientHeight + 4` that fills most of the viewport (main scroller in SPA shells).
- Find the scroll container's direct-ish children and group by signature `tag + class list + rounded width + rounded height(+-10%)`. If a group of >= 4 siblings makes up >= 60% of the overflow height, it's a list: pass. Otherwise flag as "avoidable scroll", and report the overflow in px and what is below the fold.
- Rule check: if not a list and overflow > 0, fail; if scrolling is absent and coverage < floor, fail "too empty".


## 3. What MiniMed does

`e2e/screen-density.spec.ts` measures every main screen at 390×844 and 1024×768 with the metric
above (8 px grid, boxes grown by 6 px; text line boxes, images, controls and boxes with their own
background or border) once the screen has settled (two equal readings 400 ms apart). A page that
scrolls counts as a list when one run of alike siblings (same tag, class and width) takes half its
height. The spec writes the numbers (attachment, `DENSITY_REPORT=<dir>`) and fails only under
`DENSITY_STRICT=1`, because the thresholds are still uncalibrated.

## 4. Baseline, 2026-11-08 (tool sections not installed)

| Screen | Device | Filled | Largest empty band | Scrolls | List | Flag |
| --- | --- | --- | --- | --- | --- | --- |
| home | phone | 89 % | 2 % | yes, 285 px | yes |  |
| calculators | phone | 86 % | 8 % | yes, 3422 px | yes |  |
| ciwa-ar | phone | 79 % | 7 % | yes, 417 px | yes |  |
| assessments | phone | 87 % | 8 % | yes, 416 px | yes |  |
| tools | phone | 75 % | 10 % | no |  |  |
| patients | phone | 34 % | 54 % | no |  | empty band 54 % of the screen |
| forms | phone | 88 % | 7 % | yes, 1825 px | yes |  |
| news | phone | 57 % | 21 % | no |  |  |
| settings | phone | 71 % | 14 % | no |  |  |
| home | tablet | 78 % | 2 % | yes, 334 px | yes |  |
| calculators | tablet | 72 % | 8 % | yes, 3163 px | yes |  |
| ciwa-ar | tablet | 64 % | 11 % | yes, 106 px | yes |  |
| assessments | tablet | 67 % | 8 % | yes, 104 px | yes |  |
| tools | tablet | 44 % | 25 % | no |  |  |
| patients | tablet | 29 % | 50 % | no |  | empty band 50 % of the screen |
| forms | tablet | 80 % | 8 % | yes, 1483 px | yes |  |
| news | tablet | 26 % | 51 % | no |  | empty band 51 % of the screen |
| settings | tablet | 71 % | 5 % | no |  |  |

Read: the flagged screens are the centred empty states (no patients, no feeds) — the empty band is
the design of `EmptyState`, so the floor needs an empty-state exemption or a filled empty state
(examples, suggested feeds) before `DENSITY_STRICT` can be on. CIWA-Ar on a phone scrolls 417 px;
its ten alike fields count as a list.
