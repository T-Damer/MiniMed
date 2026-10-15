import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

import { getDownloadQueue } from '@/features/downloads/download-service';

export interface DownloadsPauseControl {
  /** Module downloads are held; «Продолжить» resumes them from the bytes already received. */
  readonly paused: Accessor<boolean>;
  /** There is something to hold, or the queue is already held (so the control must stay visible). */
  readonly available: Accessor<boolean>;
  readonly toggle: () => void;
}

/** The one pause/resume switch of the module download queue, shared by every control that shows it. */
export function useDownloadsPause(): DownloadsPauseControl {
  const queue = getDownloadQueue();
  const [paused, setPaused] = createSignal(queue.isPaused());
  const [available, setAvailable] = createSignal(queue.canPause());
  onMount(() => {
    const sync = (): void => {
      setPaused(queue.isPaused());
      setAvailable(queue.canPause());
    };
    sync();
    onCleanup(queue.subscribe(sync));
  });
  return { paused, available, toggle: () => queue.setPaused(!queue.isPaused()) };
}
