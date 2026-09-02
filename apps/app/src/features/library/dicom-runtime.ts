import { init as initCornerstone } from '@cornerstonejs/core';
import { init as initDicomImageLoader } from '@cornerstonejs/dicom-image-loader';

let runtimeInitialization: Promise<void> | undefined;

function dicomWorkerCount(): number {
  const hardwareWorkers = Math.max(
    1,
    Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)),
  );
  const touchDevice =
    navigator.maxTouchPoints > 0 ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
  return touchDevice ? Math.min(2, hardwareWorkers) : hardwareWorkers;
}

export function initializeDicomRuntime(): Promise<void> {
  runtimeInitialization ??= Promise.resolve().then(() => {
    initCornerstone();
    initDicomImageLoader({
      maxWebWorkers: dicomWorkerCount(),
      wasmBasePath: new URL('cornerstone-codecs', document.baseURI).toString(),
    });
  });
  return runtimeInitialization;
}
