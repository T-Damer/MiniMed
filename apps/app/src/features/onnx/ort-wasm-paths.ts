import ortGlueUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { Env } from 'onnxruntime-web/webgpu';

/**
 * Points onnxruntime-web at the glue script and the WebAssembly file this build ships, instead of
 * letting it guess. The bundle uses its embedded glue only when it judges the worker's script
 * same-origin, and otherwise imports `ort-wasm-simd-threaded.asyncify.mjs` from beside the worker —
 * a file Vite did not emit, so on a phone the ECG digitizer failed with «no available backend
 * found … Failed to fetch dynamically imported module». Both files are build assets now (the
 * .wasm is the one the bundle already referenced; the glue adds ~50 KB), so every worker loads
 * the same two files online, offline and in the APK.
 */
export function pinOrtWasmFiles(env: Env): void {
  env.wasm.wasmPaths = { mjs: ortGlueUrl, wasm: ortWasmUrl };
  env.wasm.numThreads = 1;
}
