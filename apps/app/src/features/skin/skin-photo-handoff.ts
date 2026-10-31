export const SKIN_PHOTO_HANDOFF_EVENT = 'minimed:skin-photo-handoff';

let pending: Blob | undefined;

/** Hands one photo (a camera result that arrived after a restart) to the skin tool. */
export function handOffSkinPhoto(photo: Blob): void {
  pending = photo;
  window.dispatchEvent(new Event(SKIN_PHOTO_HANDOFF_EVENT));
}

export function takeHandedOffSkinPhoto(): Blob | undefined {
  const photo = pending;
  pending = undefined;
  return photo;
}
