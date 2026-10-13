import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { downloadTaskFraction, isDownloadActive } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { E5_DOWNLOAD_ID, E5_MODEL_TOTAL_BYTES } from './e5-model';
import { installE5Model, subscribeE5Model } from './e5-model-store';
import { resetE5QueryEmbedder } from './e5-query-embedder';

import './semantic-model-offer.css';

const SIZE_LABEL = `${Math.round(E5_MODEL_TOTAL_BYTES / 1024 / 1024)} МБ`;

export interface SemanticModelOfferProps {
  /** Runs the search again once the model is installed. */
  readonly onInstalled: () => void;
}

/**
 * Shown in «Все» when a query reads like a complaint or a description and the semantic model that
 * finds recommendations for it is not installed (roadmap items 5/14): one row with the download.
 */
export function SemanticModelOffer(props: SemanticModelOfferProps): JSX.Element {
  const queue = getDownloadQueue();
  const [task, setTask] = createSignal(queue.get(E5_DOWNLOAD_ID));
  const [failed, setFailed] = createSignal(false);
  onMount(() => {
    const subscriptions = [
      queue.subscribe(() => setTask(queue.get(E5_DOWNLOAD_ID))),
      subscribeE5Model(() => {
        resetE5QueryEmbedder();
        props.onInstalled();
      }),
    ];
    onCleanup(() => {
      for (const unsubscribe of subscriptions) unsubscribe();
    });
  });
  const downloading = () => {
    const current = task();
    return Boolean(current && isDownloadActive(current));
  };
  const progress = () => {
    const current = task();
    return current ? Math.floor((downloadTaskFraction(current) ?? 0) * 100) : 0;
  };
  const install = (): void => {
    if (downloading()) return;
    setFailed(false);
    installE5Model().catch((cause: unknown) => {
      if (!(cause instanceof Error && cause.name === 'AbortError')) setFailed(true);
    });
  };

  return (
    <section
      class="semantic-model-offer"
      aria-label="Поиск по смыслу"
      data-testid="semantic-model-offer"
    >
      <AppGlyph name="brain" class="semantic-model-offer__icon" />
      <p class="semantic-model-offer__text">
        <Show when={!failed()} fallback="Не удалось скачать модель поиска по смыслу.">
          Жалобы и описания своими словами находит поиск по смыслу
        </Show>
      </p>
      <Button
        type="button"
        variant="primary"
        class="semantic-model-offer__action"
        disabled={downloading()}
        onClick={install}
      >
        {downloading() ? `${progress()}%` : `Скачать · ${SIZE_LABEL}`}
      </Button>
    </section>
  );
}
