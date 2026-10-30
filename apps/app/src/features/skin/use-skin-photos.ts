import { createSignal } from 'solid-js';

import {
  readInstalledSkinPhotos,
  type SkinPhoto,
  type SkinPhotoIndex,
  subscribeSkinPack,
} from '@/features/skin/skin-pack';

const NONE: readonly SkinPhoto[] = [];

const [index, setIndex] = createSignal<SkinPhotoIndex>(new Map());
let started = false;
let generation = 0;

function reload(): void {
  const run = ++generation;
  readInstalledSkinPhotos().then(
    (photos) => {
      if (run === generation) setIndex(photos);
    },
    (cause: unknown) => {
      console.warn('The skin pack photos could not be read.', cause);
    },
  );
}

/**
 * The reference photos of the installed skin pack by condition id, empty without a pack. One index
 * for the whole app, read on first use and again whenever the pack is installed or removed; the
 * atlas falls back to its drawn art for a condition with no photos.
 */
export function useSkinPhotos(): (conditionId: string) => readonly SkinPhoto[] {
  if (!started) {
    started = true;
    subscribeSkinPack(reload);
    reload();
  }
  // Reads the shared signal, so a caller inside a reactive scope follows installs and removals.
  return (conditionId) => index().get(conditionId) ?? NONE;
}
