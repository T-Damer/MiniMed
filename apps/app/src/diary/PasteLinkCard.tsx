import { createSignal, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { TextArea } from '@/components/TextArea';
import { readInvitationText } from '@/features/diary/diary-codec';
import type { DiaryOpenResult, DiaryStore } from '@/features/diary/diary-storage';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * Opens the doctor's diary from a pasted link. The icon on the iOS home screen keeps its data
 * apart from Safari, so this is how a link reaches it. The same merge rules as opening the link
 * apply (a newer link updates the plan, an older one is ignored, entries are never touched).
 */
export function PasteLinkCard(props: {
  readonly store: DiaryStore;
  /** Nothing in the list yet: the card is the main thing on the page. */
  readonly prominent: boolean;
  readonly onOpened: (opened: DiaryOpenResult) => void;
}): JSX.Element {
  const [text, setText] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const add = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      const invitation = await readInvitationText(text());
      if (!invitation) {
        setError(
          'В этом тексте нет ссылки на дневник. Скопируйте ссылку от врача целиком: она содержит «#i=».',
        );
        return;
      }
      const opened = props.store.open(invitation);
      setText('');
      props.onOpened(opened);
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось открыть ссылку.'));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <p class="diary-card__text">
        Скопируйте ссылку, которую прислал врач, и вставьте её сюда. Ссылка остаётся на этом
        устройстве и никуда не отправляется.
      </p>
      <TextArea
        class="diary-paste__text"
        label="Ссылка от врача"
        value={text()}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <Button
        class="diary-button"
        type="button"
        variant="primary"
        disabled={busy() || !text().trim()}
        onClick={() => void add()}
      >
        Открыть дневник
      </Button>
      <Show when={error()}>
        <p class="diary-error" role="alert">
          {error()}
        </p>
      </Show>
    </>
  );

  return (
    <Show
      when={props.prominent}
      fallback={
        <details class="diary-card diary-paste">
          <summary class="diary-paste__summary">Добавить дневник по ссылке врача</summary>
          {body}
        </details>
      }
    >
      <section class="diary-card" aria-label="Вставьте ссылку от врача">
        <h2 class="diary-card__title">Вставьте ссылку от врача</h2>
        {body}
      </section>
    </Show>
  );
}
