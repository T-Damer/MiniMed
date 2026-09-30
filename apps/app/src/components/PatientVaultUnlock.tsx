import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Heading } from '@/components/Text';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  createPatientVault,
  patientVaultStorageMode,
  readPatientVault,
  unlockPatientVault,
} from '@/state/patient-vault';
import { isPatientVaultNativePlatform } from '@/state/patient-vault-native';
import '@/styles/patient-workspace.css';

/** A silent open that finishes sooner than this shows no progress at all. */
const PENDING_NOTICE_DELAY_MS = 400;

/**
 * Opens the patient vault. Device-key and existing vaults open silently (ADR-0016); the choice
 * card appears only when the user has to act. With `dialog`, that card is a modal and the silent
 * attempt shows nothing but a delayed status line, so a fast open never flashes a lock dialog.
 */
export function PatientVaultUnlock(props: {
  readonly onUnlocked: (snapshot: PatientVaultSnapshot) => void;
  readonly dialog?: { readonly title: string; readonly onClose: () => void };
}): JSX.Element {
  let current = true;
  const [opened, setOpened] = createSignal(false);
  const unlocked = (snapshot: PatientVaultSnapshot): void => {
    if (!current) return;
    setOpened(true);
    props.onUnlocked(snapshot);
  };
  const [storedMode, setStoredMode] =
    createSignal<Awaited<ReturnType<typeof patientVaultStorageMode>>>();
  const [attempting, setAttempting] = createSignal(true);
  const [busy, setBusy] = createSignal(true);
  const [slow, setSlow] = createSignal(false);
  const [error, setError] = createSignal('');
  const slowTimer = window.setTimeout(() => setSlow(true), PENDING_NOTICE_DELAY_MS);
  onCleanup(() => {
    current = false;
    window.clearTimeout(slowTimer);
  });
  onMount(() => {
    void (async () => {
      try {
        const mode = await patientVaultStorageMode();
        setStoredMode(mode);
        if (mode === 'unencrypted' || (!mode && !isPatientVaultNativePlatform())) return;
        if (!mode) {
          await createPatientVault();
          unlocked(await readPatientVault());
        } else unlocked(await unlockPatientVault());
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Защищённое хранилище устройства недоступно; можно продолжить без шифрования.',
        );
      } finally {
        setBusy(false);
        setAttempting(false);
      }
    })();
  });
  const continueUnencrypted = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      if (storedMode() === 'unencrypted') unlocked(await unlockPatientVault());
      else {
        await createPatientVault({ allowUnencrypted: true });
        unlocked(await readPatientVault());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть хранилище.');
    } finally {
      setBusy(false);
    }
  };
  const canUseUnencrypted = (): boolean => storedMode() !== 'native-keychain';
  const card = (): JSX.Element => (
    <section
      class={
        props.dialog
          ? 'patient-workspace__unlock patient-workspace__unlock--dialog'
          : 'patient-workspace__unlock paper-card'
      }
    >
      <AppGlyph name="lock" class="patient-workspace__unlock-icon" />
      <Heading depth={2}>
        {busy()
          ? 'Открываем пациентов…'
          : storedMode() === 'unencrypted'
            ? 'Пациенты закрыты'
            : canUseUnencrypted()
              ? 'Карточки пациентов без шифрования'
              : 'Не удалось открыть защищённое хранилище'}
      </Heading>
      <Show when={!busy() && canUseUnencrypted()}>
        <p class="patient-workspace__warning" role="alert">
          Здесь MiniMed не может зашифровать карточки. Они хранятся только на этом устройстве, но
          открыть их сможет любой, у кого есть доступ к этому браузеру. Для реальных пациентов
          используйте приложение для Android — там данные шифруются.
        </p>
      </Show>
      <Show when={error()}>
        <p class="patient-workspace__error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={!busy() && canUseUnencrypted()}>
        <Button type="button" variant="primary" onClick={() => void continueUnencrypted()}>
          {storedMode() === 'unencrypted' ? 'Открыть' : 'Понятно, продолжить'}
        </Button>
      </Show>
    </section>
  );
  const pending = (): JSX.Element => (
    <Show when={attempting() && slow()}>
      <p class="patient-vault-unlock__pending" role="status">
        Открываем пациентов…
      </p>
    </Show>
  );
  const dialog = props.dialog;
  if (!dialog)
    return (
      <Show when={!attempting()} fallback={pending()}>
        {card()}
      </Show>
    );
  return (
    <>
      {pending()}
      <OverlayDialog
        open={!attempting() && !opened()}
        title={dialog.title}
        class="patient-vault-dialog"
        tracksHistory={false}
        onClose={dialog.onClose}
      >
        {card()}
      </OverlayDialog>
    </>
  );
}
