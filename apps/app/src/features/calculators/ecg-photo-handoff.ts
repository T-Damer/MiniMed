export const ECG_PHOTO_HANDOFF_EVENT = 'minimed:ecg-photo-handoff';

let pending: File | undefined;

/** Hands one photo from an entry point to the ECG editor; the file never leaves memory. */
export function handOffEcgPhoto(file: File): void {
  pending = file;
  window.dispatchEvent(new Event(ECG_PHOTO_HANDOFF_EVENT));
}

export function takeHandedOffEcgPhoto(): File | undefined {
  const file = pending;
  pending = undefined;
  return file;
}
