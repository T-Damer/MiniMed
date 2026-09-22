# GPUI mobile + Solid: follow-up investigation

Date: 2026-09-23. Research only, in draft PR #180. No application code, dependencies,
platform configuration or release pipeline is changed by this note. The user's primary
platforms remain Android and iOS. Source/definition work remains the implementation priority.

This supplements [the earlier Solid/native assessment](solid-native-mobile-options-2026-09-22.md).
The earlier inspection of GPUIX desktop artifacts did not establish a mobile deployment path;
it must not be read as evidence that mobile GPUI does not exist.

## What the newly supplied project establishes

Inspected `itsbalamurali/gpui-mobile` at commit
`1d3ec2a1d14a63b74d1f4269340441d4eeada27a`:

- [README](https://github.com/itsbalamurali/gpui-mobile/blob/1d3ec2a1d14a63b74d1f4269340441d4eeada27a/README.md)
  describes implementations of `gpui::Platform`: iOS uses wgpu/Metal and CoreText;
  Android uses wgpu/Vulkan or GL and cosmic-text/swash. It supplies source and example
  build paths for both platforms, touch/momentum scrolling, keyboard handling and safe areas.
  The author supplies Android device screenshots; those are upstream evidence, not our device test.
- [Cargo.toml](https://github.com/itsbalamurali/gpui-mobile/blob/1d3ec2a1d14a63b74d1f4269340441d4eeada27a/Cargo.toml)
  pins `gpui` and `gpui_wgpu` to Zed commit
  `5688167d224b5eca54875d49afb8bfd73a07915a`, with additional forked dependencies.
  This is a concrete compatibility baseline, not arbitrary interchangeable GPUI versions.
  The source offers Apache-2.0 as one of its alternative licenses. Its default feature
  set enables many platform packages; this is not a measured minimal application size.
- [TODO.md](https://github.com/itsbalamurali/gpui-mobile/blob/1d3ec2a1d14a63b74d1f4269340441d4eeada27a/TODO.md)
  still lists assistive technologies, richer text-input functionality and other API/UI work.
  Treat accessibility, selection/IME and lifecycle coverage as qualification items, not
  fulfilled merely because a counter renders.

The [crates.io/docs.rs 0.1.0 release](https://docs.rs/gpui-mobile/0.1.0/gpui_mobile/)
explicitly exposes the independent momentum engine while the full platform implementation
lives in the Git repository. Installing that published crate alone is not equivalent to
checking out the full project.

## Why this is promising, but not a drop-in GPUIX mobile switch

The [official GPUIX Solid guide](https://gpuix.dev/guides/solid) already documents
`@gpuix/solid`, its universal renderer and a shared native host. Solid does not need to
be rewritten into React to use that renderer.

However, the two projects supply different parts of the stack:

```text
Solid signals + universal-rendered components        existing GPUIX adapter
                 |
JS runtime + GPUIX host mutation/event bridge         mobile integration to establish
                 |
compatible GPUI / renderer versions                   revisions to reconcile
                 |
gpui-mobile platform                                 existing mobile source implementation
                 |
UIKit / Android activity + GPU surface                per-platform build and lifecycle
```

The inspected [GPUIX native manifest](https://github.com/remorses/gpuix/blob/main/packages/native/Cargo.toml)
uses a GPUI submodule/fork and Node-API bindings, with desktop-oriented platform dependencies.
The precise revision compatibility with the mobile project's pinned Zed must be established.
A Rust mobile platform implementation does not itself provide a supported mobile Node-API
host, a complete Solid mobile package or a MiniMed storage adapter.

GPUIX also has a [Hermes-node guide](https://gpuix.dev/guides/hermes), so a full Bun executable
is not the only JS-host direction worth investigating. That guide demonstrates a macOS
CommonJS/Node-API path and documents runtime/addon gaps. It does not demonstrate the combined
Solid + GPUIX + gpui-mobile Android/iOS application. Its desktop binary measurements must not
be advertised as a mobile APK size or memory result.

A useful related precedent is [GPUI Kit's mobile guide](https://gpui-kit.com/docs/mobile/):
it builds on a Longbridge compatibility fork, documents a Swift-hosted iOS simulator example,
and labels the integration experimental. Its stated Android and physical-iPhone verification
limits belong to that particular integration, not proof that the original platform cannot
run there. Do not mix its dependency versions or minimum OS targets with the original repo.

## MiniMed-specific questions before even considering adoption

Keep the current application unchanged. A future isolated feasibility check should first:

1. Reproduce a pinned Rust Android example and then prove a minimal Solid tree can drive the
   same mobile host. Record what bridge/runtime changes were required. Compiling GPUI alone
   is not a Solid integration test.
2. Reuse existing contracts, source IDs and MedicalCore/ports where compatible. Establish
   one storage owner per database; do not introduce parallel SQLite/OPFS ownership or UI SQL.
3. Use an actual reference screen: Cyrillic search input, bounded result list, source definition,
   selectable/copyable text, a wide pediatric table and a citation. DOM readers/editors are
   not assumed portable to a non-DOM renderer.
4. Check Russian IME/composition, focus/selection, TalkBack and VoiceOver, system font scaling,
   touch scrolling, safe areas, keyboard occlusion, Android back, background/resume and process
   recreation. A screen-reader TODO is important for a medical reference, not cosmetic polish.
5. Compare release builds on the same physical device and dataset: cold/warm startup,
   frame times, install size, idle/peak PSS, battery behavior and offline restart. GPU rendering
   alone establishes neither lower memory nor better clinical-search latency.

NativeScript + Solid remains another candidate; GPUIX + gpui-mobile is now explicitly a
credible research route rather than a desktop-only dead end. There is no ranked winner
until the missing host integration and real-device comparison are demonstrated.

## Execution boundary

This pass inspected upstream documentation and source manifests/TODOs; it did not compile
GPUI, run a simulator/device, add Rust or replace Capacitor. No framework migration is
proposed as a prerequisite for collecting terms or using a local classifier.
