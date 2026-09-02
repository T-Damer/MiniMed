const VIEWER_LOAD_TIMEOUT_MS = 30_000;
const PRESS_REPEAT_DELAY_MS = 360;
const PRESS_REPEAT_INTERVAL_MS = 90;

export interface MedicalImagePressRepeat {
  readonly start: () => void;
  readonly stop: () => void;
  readonly activate: () => void;
  readonly dispose: () => void;
}

export function createMedicalImagePressRepeat(
  action: () => void,
  canRun: () => boolean = () => true,
): MedicalImagePressRepeat {
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let repeatTimer: ReturnType<typeof setInterval> | undefined;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let repeated = false;

  const clearRepeatTimers = (): void => {
    if (delayTimer !== undefined) clearTimeout(delayTimer);
    if (repeatTimer !== undefined) clearInterval(repeatTimer);
    delayTimer = undefined;
    repeatTimer = undefined;
  };

  const clearResetTimer = (): void => {
    if (resetTimer !== undefined) clearTimeout(resetTimer);
    resetTimer = undefined;
  };

  const repeat = (): void => {
    if (!canRun()) {
      clearRepeatTimers();
      return;
    }
    repeated = true;
    action();
  };

  const start = (): void => {
    clearRepeatTimers();
    clearResetTimer();
    repeated = false;
    if (!canRun()) return;
    delayTimer = setTimeout(() => {
      delayTimer = undefined;
      if (!canRun()) return;
      repeat();
      repeatTimer = setInterval(repeat, PRESS_REPEAT_INTERVAL_MS);
    }, PRESS_REPEAT_DELAY_MS);
  };

  const stop = (): void => {
    clearRepeatTimers();
    if (!repeated) return;
    clearResetTimer();
    resetTimer = setTimeout(() => {
      repeated = false;
      resetTimer = undefined;
    }, 0);
  };

  const activate = (): void => {
    clearResetTimer();
    if (repeated) {
      repeated = false;
      return;
    }
    if (canRun()) action();
  };

  return {
    start,
    stop,
    activate,
    dispose: () => {
      clearRepeatTimers();
      clearResetTimer();
    },
  };
}

export function volumeCutawayPlanes(crosshair: readonly [number, number, number]): number[][] {
  return [
    [crosshair[0] - 0.5, 90, 0],
    [crosshair[1] - 0.5, 180, 0],
    [0.5 - crosshair[2], 0, -90],
  ];
}

export function medicalImageSliceDragSteps(
  startY: number,
  currentY: number,
  pixelsPerStep: number,
): number {
  return Math.trunc((startY - currentY) / Math.max(1, pixelsPerStep));
}

export function medicalImagePointerAction(
  view: 'multiplanar' | 'axial' | 'coronal' | 'sagittal' | 'render',
  isRenderTile: boolean,
  canDragSlice: boolean,
  viewerToolActive = false,
  rotate3D = false,
  annotationActive = false,
): 'blocked' | 'cursor' | 'slice' | 'viewer' {
  if ((view === 'render' || view === 'multiplanar') && isRenderTile) {
    if (annotationActive) return 'blocked';
    return rotate3D ? 'viewer' : 'cursor';
  }
  if (annotationActive) return 'viewer';
  if (viewerToolActive) return 'viewer';
  return canDragSlice ? 'slice' : 'viewer';
}

export async function readBlobWithProgress(
  blob: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(blob.size);
  const reader = blob.stream().getReader();
  let offset = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Операция отменена.', 'AbortError');
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
      onProgress(blob.size > 0 ? Math.min(1, offset / blob.size) : 1);
    }
  } finally {
    reader.releaseLock();
  }
  onProgress(1);
  return bytes.buffer;
}

export async function withViewerTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), VIEWER_LOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
