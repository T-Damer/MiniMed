/** The part of an audio element that the duration fix touches. */
export interface RecordedAudio {
  duration: number;
  currentTime: number;
  addEventListener(type: 'timeupdate', listener: () => void): void;
  removeEventListener(type: 'timeupdate', listener: () => void): void;
}

/**
 * A MediaRecorder file has no length in its header, so a player reports `Infinity` (shown as 0:00)
 * until the browser has read to the end. Seeking far past the end makes it do that; once the real
 * length is known the player goes back to the start.
 */
export function resolveRecordedDuration(audio: RecordedAudio): void {
  if (Number.isFinite(audio.duration)) return;
  const restore = (): void => {
    if (!Number.isFinite(audio.duration)) return;
    audio.removeEventListener('timeupdate', restore);
    audio.currentTime = 0;
  };
  audio.addEventListener('timeupdate', restore);
  audio.currentTime = 1e101;
}
