import { createSignal, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { FileButton } from '@/components/FileButton';
import { TextArea } from '@/components/TextArea';
import { entriesLabel } from '@/diary/diary-format';
import { decodeDiaryResultsText } from '@/features/diary/diary-codec';
import type { DiaryStore } from '@/features/diary/diary-storage';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Brings records back from a saved file or pasted text: a new phone, another browser, or the
 * icon on the iOS home screen. Records are added to the diary, never replace it.
 */
export function RestoreCard(props: {
  readonly store: DiaryStore;
  readonly onRestored: (diaryId: string) => void;
}): JSX.Element {
  const [text, setText] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const restore = async (source: string): Promise<void> => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const results = await decodeDiaryResultsText(source);
      const merge = props.store.restore(results);
      const parts = [
        merge.added > 0 ? `Добавлено: ${entriesLabel(merge.added)}.` : 'Новых записей нет.',
        merge.kept > 0
          ? `${entriesLabel(merge.kept)} уже были на устройстве и остались без изменений.`
          : '',
        merge.skipped > 0
          ? `${entriesLabel(merge.skipped)} не подошли к текущей версии дневника.`
          : '',
      ].filter(Boolean);
      setMessage(parts.join(' '));
      setText('');
      props.onRestored(results.invitation.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось восстановить записи.'));
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (files: FileList | null): Promise<void> => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('Файл слишком большой для дневника.');
      return;
    }
    await restore(await file.text());
  };

  return (
    <details class="diary-card diary-restore">
      <summary class="diary-restore__summary">Восстановить записи из файла или текста</summary>
      <p class="diary-card__text">
        Подойдёт файл или текст, который вы сохраняли кнопкой «Передать врачу» («Сохранить файл» или
        «Скопировать текстом»). В нём есть и сам дневник, и ваши записи, поэтому подойдёт и пустое
        приложение: дневник появится в списке вместе с записями. Если дневник уже есть, записи
        добавятся к нему, ничего не заменится.
      </p>
      <FileButton
        class="diary-restore__file"
        accept=".txt,text/plain"
        aria-label="Выбрать файл с записями"
        onChange={(event) => {
          void readFile(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      >
        Выбрать файл
      </FileButton>
      <TextArea
        class="diary-restore__text"
        label="Или вставьте текст"
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <Button
        class="diary-button"
        type="button"
        variant="primary"
        disabled={busy() || !text().trim()}
        onClick={() => void restore(text())}
      >
        Восстановить
      </Button>
      <Show when={message()}>
        <p class="diary-card__text" role="status">
          {message()}
        </p>
      </Show>
      <Show when={error()}>
        <p class="diary-error" role="alert">
          {error()}
        </p>
      </Show>
    </details>
  );
}
