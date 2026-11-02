# Illustrations

App-style illustrations (green leather, cream paper, dashed stitching, the red-cross badge — the
language of `public/diaries/logo.svg` and the app icon), drawn as SVG for the diary presentation
(`docs/promo/diary-presentation/`) and kept here for use in the app.

| Name | Shows |
| --- | --- |
| `phone` | a phone in a leather case with a checklist and a heartbeat line |
| `android` | an Android phone (green case, punch-hole camera, a little robot on screen) |
| `ios` | an iPhone (sand case, Dynamic Island, an apple on screen) |
| `doctor` | a laptop with a chart and a calendar grid |
| `lock` | a stitched padlock with the red-cross keyhole plate |
| `cloud` | a stitched cloud on a small server box |
| `offline` | the diary notebook with sync arrows and a crossed-out Wi-Fi badge |
| `fhir` | two record cards exchanging data |
| `pills` | a blister pack with a ticked tag |
| `heart` | a heart with a heartbeat line on a stitched plate |

`svg/<name>.svg` are the sources (viewBox `0 0 512 512`, transparent). `illustrations.sprite.svg`
holds them all as `<symbol id="ill-<name>">`; rebuild it with `bun scripts/build-illustration-sprite.ts`.

Inline the sprite hidden with `width="0" height="0"`, not `display: none`: Chrome does not paint
gradients defined inside a `display: none` SVG, so the illustrations come out flat.
