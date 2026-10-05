import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import {
  getReferenceImageResolver,
  REFERENCE_IMAGES_DOWNLOAD_ID,
} from '@/features/library/reference-image-assets';
import {
  chooseReferenceImageExamples,
  parseBundledPreviewIndex,
  REFERENCE_IMAGE_EXAMPLE_LIMIT,
  type ReferenceImageExample,
  type ReferenceImageExamples,
  type ReferenceImagesContents,
  referenceImageExamplesNote,
  referenceImagesContentsLabel,
} from '@/features/settings/reference-image-examples';

function bundledUrl(path: string): string {
  return new URL(
    `content/reference-images-preview/${path}`,
    new URL(import.meta.env.BASE_URL, window.location.href),
  ).href;
}

async function loadBundledExamples(): Promise<readonly ReferenceImageExample[]> {
  const response = await fetch(bundledUrl('index.json'), { credentials: 'same-origin' });
  if (!response.ok) return [];
  return parseBundledPreviewIndex(await response.json(), bundledUrl);
}

/**
 * What the reference-image set holds and a few real pictures from it: the downloaded ones when the
 * set is on the device, otherwise the originals bundled with the app. Only reads: nothing here
 * starts a download.
 */
export function ReferenceImageExamplesPanel(): JSX.Element {
  const resolver = getReferenceImageResolver();
  const queue = getDownloadQueue();
  const [contents, setContents] = createSignal<ReferenceImagesContents>();
  const [examples, setExamples] = createSignal<ReferenceImageExamples>();
  const [failed, setFailed] = createSignal(false);

  onMount(() => {
    let disposed = false;
    const load = async (): Promise<void> => {
      const [summary, downloaded, bundled] = await Promise.allSettled([
        resolver.contentSummary(),
        resolver.cachedSamples(REFERENCE_IMAGE_EXAMPLE_LIMIT),
        loadBundledExamples(),
      ]);
      if (disposed) return;
      if (summary.status === 'fulfilled') setContents(summary.value);
      else setFailed(true);
      for (const result of [summary, downloaded, bundled]) {
        if (result.status === 'rejected') {
          console.warn('Часть примеров иллюстраций не загрузилась.', result.reason);
        }
      }
      setExamples(
        chooseReferenceImageExamples(
          downloaded.status === 'fulfilled' ? downloaded.value : [],
          bundled.status === 'fulfilled' ? bundled.value : [],
        ),
      );
    };
    const refresh = (): void => {
      load().then(
        () => undefined,
        (cause: unknown) => {
          console.warn('Примеры иллюстраций не загрузились.', cause);
          if (!disposed) setFailed(true);
        },
      );
    };
    refresh();
    let previous = queue.get(REFERENCE_IMAGES_DOWNLOAD_ID)?.state;
    const unsubscribe = queue.subscribe(() => {
      const current = queue.get(REFERENCE_IMAGES_DOWNLOAD_ID);
      if (current?.state !== previous && current && !isDownloadActive(current)) refresh();
      previous = current?.state;
    });
    const unsubscribeRemoved = resolver.subscribeRemoved(refresh);
    onCleanup(() => {
      disposed = true;
      unsubscribe();
      unsubscribeRemoved();
    });
  });

  return (
    <section
      class="reference-image-examples paper-sheet"
      aria-labelledby="reference-image-examples-heading"
      data-testid="reference-image-examples"
    >
      <h3 id="reference-image-examples-heading" class="reference-image-examples__title">
        Что в наборе
      </h3>
      <p class="reference-image-examples__contents" data-testid="reference-image-contents">
        <Show
          when={contents()}
          fallback={failed() ? 'Состав набора не удалось прочитать.' : 'Читаем состав набора…'}
        >
          {(value) => referenceImagesContentsLabel(value())}
        </Show>
      </p>
      <Show when={examples()}>
        {(value) => (
          <>
            <Show when={value().images.length > 0}>
              <ul class="reference-image-examples__grid" aria-label="Примеры иллюстраций">
                <For each={value().images}>
                  {(image) => (
                    <li class="reference-image-examples__item">
                      <figure class="reference-image-examples__figure">
                        <img
                          class="reference-image-examples__image"
                          src={image.url}
                          alt={image.alt}
                          loading="lazy"
                          decoding="async"
                        />
                        <figcaption class="reference-image-examples__caption">
                          {image.alt}
                        </figcaption>
                      </figure>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <p class="reference-image-examples__note" data-testid="reference-image-examples-note">
              {referenceImageExamplesNote(value())}
            </p>
          </>
        )}
      </Show>
      <p class="reference-image-examples__source">
        Источник иллюстраций: krasotaimedicina.ru. У каждой сохранена ссылка на оригинал.
      </p>
    </section>
  );
}
