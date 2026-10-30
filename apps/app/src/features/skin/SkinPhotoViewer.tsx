import { createMemo, type JSX, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import { PinchZoomSurface } from '@/features/library/PinchZoomSurface';
import { IMAGE_ZOOM_OPTIONS } from '@/features/library/use-pinch-zoom';
import { createSkinPhotoUrl } from '@/features/skin/SkinPhotoImage';
import type { SkinPhoto } from '@/features/skin/skin-pack';

import '@/styles/skin-pack.css';

/** «Source · author · licence»: the one caption of a photo, shown only in the opened view. */
export function skinPhotoCredit(photo: SkinPhoto): string {
  return [photo.source, photo.author.trim(), photo.licence].filter((part) => part).join(' · ');
}

/**
 * A reference photo opened large, with the pinch-zoom of the app's other image views. The credit
 * (source, author, licence, link to the source) is one small line under the picture; the page that
 * shows the photo as a tile carries none.
 */
export function SkinPhotoViewer(props: {
  readonly photo: SkinPhoto | undefined;
  readonly title: string;
  readonly onClose: () => void;
}): JSX.Element {
  // The dialog plays its exit after `photo` is gone: it keeps showing the last one meanwhile.
  let last: SkinPhoto | undefined;
  const shown = createMemo(() => {
    last = props.photo ?? last;
    return last;
  });
  const url = createSkinPhotoUrl(
    () => shown()?.file ?? '',
    () => shown() !== undefined,
  );
  return (
    <OverlayDialog
      open={props.photo !== undefined}
      title={props.title}
      class="skin-photo-viewer"
      bodyClass="skin-photo-viewer__body"
      presentation="screen"
      onClose={props.onClose}
    >
      <Show when={shown()}>
        {(photo) => (
          <>
            <div class="skin-photo-viewer__stage">
              <PinchZoomSurface
                class="pinch-zoom-surface pinch-zoom-surface--image"
                zoomOptions={IMAGE_ZOOM_OPTIONS}
              >
                <Show when={url()}>
                  {(src) => (
                    <img
                      class="skin-photo-viewer__image"
                      src={src()}
                      alt={props.title}
                      width={photo().width}
                      height={photo().height}
                      draggable={false}
                    />
                  )}
                </Show>
              </PinchZoomSurface>
            </div>
            <p class="skin-photo-viewer__credit" data-testid="skin-photo-credit">
              <span class="skin-photo-viewer__credit-text">{skinPhotoCredit(photo())}</span>
              <a
                class="skin-photo-viewer__credit-link"
                href={photo().url}
                target="_blank"
                rel="noreferrer"
              >
                Источник
              </a>
            </p>
          </>
        )}
      </Show>
    </OverlayDialog>
  );
}
