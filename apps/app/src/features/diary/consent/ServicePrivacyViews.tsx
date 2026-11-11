import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { ConsentDocumentText } from '@/features/diary/consent/ConsentDocumentText';
import {
  SERVICE_OPERATOR_LINE,
  SERVICE_PRIVACY,
  SERVICE_PRIVACY_CONTACT,
} from '@/features/diary/consent/service-privacy';
import '@/components/ConfirmationDialog.css';
import '@/features/diary/consent/consent.css';

/** The policy as a document: who runs the service, the short version, then the full text. */
function PolicyBody(): JSX.Element {
  return (
    <div class="service-privacy" data-testid="service-privacy">
      <p class="service-privacy__operator">
        {SERVICE_OPERATOR_LINE} · {SERVICE_PRIVACY_CONTACT}
      </p>
      <ul class="service-privacy__summary">
        <For each={SERVICE_PRIVACY.summary}>{(line) => <li>{line}</li>}</For>
      </ul>
      <ConsentDocumentText document={SERVICE_PRIVACY} />
    </div>
  );
}

/** The policy, opened from a link or a menu entry; closes like any sheet. */
export function ServicePrivacyDialog(props: { readonly onClose: () => void }): JSX.Element {
  return (
    <OverlayDialog open title={SERVICE_PRIVACY.title} onClose={props.onClose}>
      <PolicyBody />
    </OverlayDialog>
  );
}

/**
 * The link inside the sign-up checkbox's label: opens the policy without ticking the box. The sheet
 * is mounted only while open.
 */
export function ServicePrivacyLink(props: { readonly children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button
        type="button"
        class="service-privacy__link"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {props.children}
      </button>
      <Show when={open()}>
        <ServicePrivacyDialog onClose={() => setOpen(false)} />
      </Show>
    </>
  );
}

/**
 * For a doctor whose account has not accepted the current wording: the policy and two answers.
 * It cannot be dismissed, but it is short: «Принимаю» records the consent, «Выйти» signs out.
 */
export function ServicePrivacyAccept(props: {
  readonly busy: boolean;
  readonly error: string;
  readonly onAccept: () => void;
  readonly onLeave: () => void;
}): JSX.Element {
  return (
    <OverlayDialog
      open
      dismissible={false}
      tracksHistory={false}
      role="alertdialog"
      title="Политика обработки данных"
      subtitle="Мы обновили правила для аккаунтов врачей. Прочитайте и примите их, чтобы продолжить."
      onClose={() => undefined}
    >
      <PolicyBody />
      <Show when={props.error}>
        <p class="service-privacy__error" role="alert">
          {props.error}
        </p>
      </Show>
      <div class="confirmation-sheet__actions">
        <button
          type="button"
          class="confirmation-sheet__button"
          disabled={props.busy}
          onClick={props.onLeave}
        >
          <AppGlyph name="arrow-square-out" class="confirmation-sheet__icon" />
          Выйти
        </button>
        <button
          type="button"
          class="confirmation-sheet__button confirmation-sheet__button--confirm"
          disabled={props.busy}
          onClick={props.onAccept}
        >
          <AppGlyph name="check" class="confirmation-sheet__icon" />
          Принимаю
        </button>
      </div>
    </OverlayDialog>
  );
}
