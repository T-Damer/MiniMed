import { DIARY_CHAT_TEXT_LIMIT } from '@localmed/contracts';
import { randomId } from '@localmed/diary-sync';
import { createSignal, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import '@/diary/diary-thread.css';

export function DiaryChatComposer(props: {
  readonly label: string;
  readonly send: (id: string, text: string) => Promise<void>;
}): JSX.Element {
  const [text, setText] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal(false);
  let pending: { readonly id: string; readonly text: string } | undefined;
  const send = async () => {
    const message = text().trim();
    if (!message || busy()) return;
    if (pending?.text !== message) pending = { id: randomId(), text: message };
    setBusy(true);
    setProblem(false);
    try {
      await props.send(pending.id, pending.text);
      setText('');
      pending = undefined;
    } catch {
      setProblem(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      class="diary-thread__composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        class="diary-thread__input"
        aria-label={props.label}
        placeholder={props.label}
        rows={1}
        maxLength={DIARY_CHAT_TEXT_LIMIT}
        value={text()}
        readOnly={busy()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <Button
        type="submit"
        variant="icon"
        class="diary-thread__send"
        icon={<AppGlyph name="arrow-up" />}
        aria-label="Отправить сообщение"
        disabled={!text().trim() || busy()}
      />
      <Show when={problem()}>
        <p class="diary-thread__error" role="alert">
          Сообщение не отправлено. Можно повторить.
        </p>
      </Show>
    </form>
  );
}
