# SolidJS native UI: GPUIX and mobile options

Checked: 2026-09-22. Research only, not an adoption ADR or a migration. Same draft PR #180.
No package, native runtime, renderer or framework was installed or enabled by this assessment.
Definitions and source intake remain the execution priority.

## Finding: a GPUIX Solid adapter already exists

The official [Solid guide](https://gpuix.dev/guides/solid) documents `@gpuix/solid`, a Solid 1
renderer for the shared GPUI native host. It is not necessary to build a Solid-to-React wrapper.
The guide uses Solid's universal compiler, supports `solid-js >=1.9 <2`, and requires the adapter
and native package to be pinned to the same exact version while GPUIX is pre-1.0.

The inspected [native package manifest](https://raw.githubusercontent.com/remorses/gpuix/main/packages/native/package.json)
identifies version 0.10.0 and these native binary targets:

- `aarch64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

Those are desktop targets, not iOS or Android. The documented native setup uses a Bun/Node-style
N-API host; the package also has a browser export. A browser build is not evidence of a supported
native Android/iOS application. No supported mobile native build/packaging path was established
from the inspected material. This is a current support finding, not a claim that a port is impossible.
The source URLs above track upstream main; the observed versions/targets are dated observations.

**Assessment:** suitable for a separate desktop experiment, not a reason to replace MiniMed's
mobile runtime now. A mobile port would need a supported host, platform integration and release
pipeline; preserving Solid reactivity alone would not supply those pieces.

## Existing native mobile route: NativeScript + Solid

[NativeScript's introduction](https://docs.nativescript.org/) documents Android and iOS runtimes
and lists Solid among its framework integrations. The
[community Solid adapter](https://github.com/nativescript-community/solid-js) renders through
DOMiNATIVE on NativeScript. Its example uses native layout/control elements such as `stacklayout`
and `label`, with `on:tap` rather than ordinary browser event delegation. This is an existing
route worth testing; it is not evidence that MiniMed's web UI can be copied unchanged.

The inspected [adapter manifest](https://raw.githubusercontent.com/nativescript-community/solid-js/main/package.json)
shows version 0.1.2, with peer dependencies including `dominative ^0.1.2`, `solid-js ^1.8.11`,
and `babel-preset-solid ^1.8.9`. A declared compatible version range is not a successful integration
test. Platform/runtime maturity and this particular community renderer's maturity are separate
questions. No Android/iOS build or device performance measurement was performed here.

## A smaller hybrid experiment also exists

[NativeScript Capacitor installation](https://capacitor.nativescript.org/installation) documents
an 8.x plugin for Capacitor 8 on Android/iOS, native TypeScript helpers and a native modal example.
It can support isolated native functionality while keeping the existing web application.
It does **not** automatically turn Solid DOM components into native controls, and this assessment
has not established that the full Solid renderer can simply be embedded through that plugin.

**Engineering judgment:** compare an ordinary small Capacitor native plugin with this extra
runtime before adding it. An additional native JavaScript runtime is a dependency and memory
budget to measure, not an assumed speedup. Use it only when it demonstrably simplifies a required
feature; do not add it merely because it has 'native' in the name.

## What is reusable in MiniMed

The inspected [app manifest](../../apps/app/package.json), at MiniMed commit
`cf1f62a12850e16b668b65ef0c13eb94d18041ab`, pins Solid 1.9.14 and Capacitor core/platforms 8.5.0.
Its Solid version falls within the GPUIX guide's peer range, but that establishes only a version
constraint, not application compatibility. Existing dependencies include DOM-oriented document
readers/editors, Kobalte, Milkdown, PDF.js, EPUB rendering and OverlayScrollbars.

Solid's [universal renderer contract](https://github.com/solidjs/solid/blob/main/packages/solid/universal/README.md)
allows rendering outside the browser. Reactivity and the rendering target are distinct.
[Capacitor's architecture](https://ionic.io/blog/how-capacitor-works-2) instead preserves a web UI
inside a native container and exposes native features through plugins.

Proposed reuse boundary, not implemented code:

```text
shared TypeScript contracts / MedicalCore / query state
                        |
                    storage port
                        |
             target-specific SQLite adapter

Solid web components       Solid native components
DOM / current Capacitor    NativeScript renderer (experiment)
```

Keep source identities, prepared content format and domain logic. Replace or adapt target-specific
storage/plugin boundaries through the existing ports. Do not import SQL/native bindings into UI.
Native layout, navigation, rich text, table interaction and document viewers need an explicit
implementation or an isolated web fallback. Do not promise source-compatible CSS or reuse every
DOM library. No second SQLite/OPFS owner should be introduced by the experiment.

## Proposed qualification before a migration decision

Use one small native screen: Russian search input, bounded results, opening a full source definition,
its citation and a wide reference table. Feed it the same immutable local content and search logic
as the current app. This tests the actual product rather than a counter demo.

Compare both implementations on the same physical Android device and release configuration:
cold/warm startup, query latency, scrolling frame times, idle and peak memory, keyboard/input
composition, text selection, TalkBack, font scaling, offline restart and background/resume.
Qualify iOS/VoiceOver separately. Record package size and battery behavior; desktop FPS, sample
binary size and post-open SQL timings do not prove mobile gains.

Decision today: keep the present Solid + Capacitor application. A NativeScript + Solid proof of
concept is the more relevant candidate for a genuinely native mobile UI. GPUIX remains a desktop
candidate until its mobile host/support story is demonstrated. No migration, Android benchmark,
new dependency, APK, deployment, model download or release is claimed by this note.
