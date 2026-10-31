import { createMemo, createSignal, For, type JSX, onCleanup, onMount } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { TextField } from '@/components/TextField';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  confirmPatientVaultRecoveryCode,
  PATIENT_VAULT_RECOVERY_EVENT,
  pendingPatientVaultRecoveryCode,
  recoverPatientVaultWithCode,
} from '@/state/patient-vault';

import '@/components/patient-vault-recovery.css';

/**
 * «Код восстановления хранилища»: the code of a freshly made recovery blob, shown once. The sheet
 * cannot be dismissed; «Я записал» stores the confirmation. Left unconfirmed, the code is gone with
 * the session and the next unlock offers a new one. Mounted once, at the app root, because the
 * code appears wherever the vault happens to be created, migrated or recovered.
 */
export function PatientVaultRecoveryHost(): JSX.Element {
  const [pending, setPending] = createSignal(pendingPatientVaultRecoveryCode());
  // The last code stays readable while the sheet plays its exit animation.
  const [shown, setShown] = createSignal(pending() ?? '');
  const [busy, setBusy] = createSignal(false);
  onMount(() => {
    const sync = (): void => {
      const next = pendingPatientVaultRecoveryCode();
      if (next) setShown(next);
      setPending(next);
    };
    window.addEventListener(PATIENT_VAULT_RECOVERY_EVENT, sync);
    onCleanup(() => window.removeEventListener(PATIENT_VAULT_RECOVERY_EVENT, sync));
  });
  const groups = createMemo(() => shown().split('-'));
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(shown());
      toast.success('Скопировано.');
    } catch {
      toast.error('Не удалось скопировать.');
    }
  };
  const confirm = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      await confirmPatientVaultRecoveryCode();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить отметку.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <OverlayDialog
      open={Boolean(pending())}
      title="Код восстановления хранилища"
      dismissible={false}
      class="patient-vault-recovery-sheet"
      onClose={() => undefined}
    >
      <div class="patient-vault-recovery">
        <div class="patient-vault-recovery__code-row">
          <p class="patient-vault-recovery__code" data-testid="patient-vault-recovery-code">
            <For each={groups()}>
              {(group) => <span class="patient-vault-recovery__group">{group}</span>}
            </For>
          </p>
          <Button
            type="button"
            variant="icon"
            class="patient-vault-recovery__copy"
            aria-label="Скопировать код"
            icon={<AppGlyph name="copy" />}
            onClick={() => void copy()}
          />
        </div>
        <p class="patient-vault-recovery__line">
          Запишите его: он откроет хранилище, если смените блокировку экрана
        </p>
        <Button
          type="button"
          variant="primary"
          disabled={busy()}
          icon={<AppGlyph name="check" />}
          onClick={() => void confirm()}
        >
          Я записал
        </Button>
      </div>
    </OverlayDialog>
  );
}

/** Typing the code back: the vault opens and moves onto a new key and a new code. */
export function PatientVaultRecoveryForm(props: {
  readonly onRecovered: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const [code, setCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (busy() || !code().trim()) return;
    setBusy(true);
    setError('');
    try {
      props.onRecovered(await recoverPatientVaultWithCode(code()));
      setCode('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось восстановить.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="patient-vault-recovery__form" onSubmit={(event) => void submit(event)}>
      <TextField
        label="Код восстановления"
        hideLabel
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        inputClass="patient-vault-recovery__input"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck={false}
        enterkeyhint="done"
        value={code()}
        error={error() || undefined}
        onInput={(event) => {
          setCode(event.currentTarget.value);
          if (error()) setError('');
        }}
      />
      <Button
        type="submit"
        variant="primary"
        disabled={busy() || !code().trim()}
        icon={<AppGlyph name="lock" />}
      >
        {busy() ? 'Проверяем…' : 'Восстановить'}
      </Button>
    </form>
  );
}
