# Production download smoke

The `Production download smoke` workflow exercises the delivery paths that deterministic E2E normally replaces with fixtures.

It boots the production build, installs the published Russian pediatric regulatory SQLite module through the real MiniMed catalog and artifact resolver, verifies the module's checksum/schema/SQLite integrity state, connects it to search and queries a known document. It also loads the real wllama JavaScript and WebAssembly runtime and checks the pinned Hugging Face model source without downloading the complete model.

The planned `models-preview-1` GitHub Release mirror is not currently published. MiniMed therefore leaves the default mirror base empty and uses the catalog's immutable upstream model URLs. A mirror can be enabled later with `VITE_LOCAL_MODEL_ASSET_BASE_URL` after its release assets exist and pass the same smoke test.
