import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SheetPopover } from '@/components/SheetPopover';
import type { ResolvedMedicationPackagingImage } from '@/features/medications/medication-packaging-images';
import { packagingImageSourceView } from '@/features/medications/packaging-image-source';

import '@/features/medications/packaging-image-source.css';

/**
 * A small round «?» laid over a packaging photo. It opens the photo's source: the site, the
 * address of the file and the day it was fetched (a popover on wide screens, a sheet on phones).
 */
export function PackagingImageSource(props: {
  readonly image: ResolvedMedicationPackagingImage;
  /** Placement of the button inside its photo frame. */
  readonly class?: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const view = () => packagingImageSourceView(props.image);
  return (
    <SheetPopover
      open={open()}
      onOpenChange={setOpen}
      title="Источник изображения"
      triggerClass={`packaging-image-source__button ${props.class ?? ''}`.trim()}
      triggerLabel="Источник изображения"
      triggerTitle="Источник изображения"
      trigger={<AppGlyph name="question" class="packaging-image-source__icon" />}
      contentClass="packaging-image-source__panel"
      placement="bottom-end"
    >
      <div class="packaging-image-source__body">
        <p class="packaging-image-source__site">{view().siteName}</p>
        <Show when={view().url}>
          {(url) => (
            <a class="packaging-image-source__link" href={url()} rel="noreferrer" target="_blank">
              {view().urlLabel}
            </a>
          )}
        </Show>
        <Show when={view().fetched}>
          {(fetched) => <p class="packaging-image-source__date">Получено {fetched()}</p>}
        </Show>
      </div>
    </SheetPopover>
  );
}
