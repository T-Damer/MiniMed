import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Heading } from '@/components/Text';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  createPatientVault,
  encryptPatientVault,
  isEncryptedPatientVaultMode,
  isPatientVaultUnlocked,
  PatientVaultError,
  patientVaultStorageMode,
  readPatientVault,
  unlockPatientVault,
} from '@/state/patient-vault';
import '@/styles/patient-workspace.css';

/** A silent open that finishes sooner than this shows no progress at all. */
const PENDING_NOTICE_DELAY_MS = 400;

/**
 * Opens the patient vault. Encrypted vaults open silently (ADR-0016): the Android Keystore on a
 * phone, the browser's non-extractable device key elsewhere; the first use creates the encrypted
 * vault without asking (what the browser key protects lives behind the «?» of the patients page).
 * The choice card appears only when the user has to act: a plaintext vault that can be encrypted in
 * place, a browser that cannot keep a key at all, or a creation that failed.
 * With `dialog`, that card is a modal and the silent attempt shows nothing but a delayed status
 * line, so a fast open never flashes a lock dialog.
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
  /** The browser refused to keep an encryption key: plaintext is the only choice left. */
  const [noDeviceKey, setNoDeviceKey] = createSignal(false);
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
        // A session that is still open is only read: unlocking again would announce a lock to every
        // screen that clears its draft when the vault closes.
        if (isEncryptedPatientVaultMode(mode)) {
          unlocked(await (isPatientVaultUnlocked() ? readPatientVault() : unlockPatientVault()));
        } else if (!mode) {
          await createPatientVault();
          unlocked(await readPatientVault());
        }
      } catch (cause) {
        fail(cause, 'Защищённое хранилище устройства недоступно.');
      } finally {
        setBusy(false);
        setAttempting(false);
      }
    })();
  });
  const fail = (cause: unknown, fallback: string): void => {
    if (cause instanceof PatientVaultError && cause.code === 'unavailable') setNoDeviceKey(true);
    setError(cause instanceof Error ? cause.message : fallback);
  };
  const createEncrypted = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      await createPatientVault();
      unlocked(await readPatientVault());
    } catch (cause) {
      fail(cause, 'Не удалось создать хранилище.');
    } finally {
      setBusy(false);
    }
  };
  const encryptExisting = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      await encryptPatientVault();
      unlocked(await readPatientVault());
    } catch (cause) {
      fail(cause, 'Не удалось зашифровать хранилище.');
    } finally {
      setBusy(false);
    }
  };
  const continueUnencrypted = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      if (storedMode() === 'unencrypted') unlocked(await unlockPatientVault());
      else {
        await createPatientVault({ allowUnencrypted: true });
        setStoredMode('unencrypted');
        unlocked(await readPatientVault());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть хранилище.');
    } finally {
      setBusy(false);
    }
  };
  /** An encrypted vault that did not open: nothing to choose, only the reason to show. */
  const openFailed = (): boolean => isEncryptedPatientVaultMode(storedMode());
  const upgradable = (): boolean => storedMode() === 'unencrypted' && !noDeviceKey();
  const firstUse = (): boolean => !storedMode() && !noDeviceKey();
  const heading = (): string => {
    if (busy()) return 'Открываем пациентов…';
    if (openFailed()) return 'Не удалось открыть защищённое хранилище';
    if (firstUse()) return 'Не удалось создать хранилище';
    return 'Карточки пациентов без шифрования';
  };
  const card = (): JSX.Element => (
    <section
      class={
        props.dialog
          ? 'patient-workspace__unlock patient-workspace__unlock--dialog'
          : 'patient-workspace__unlock paper-card'
      }
    >
      <AppGlyph name="lock" class="patient-workspace__unlock-icon" />
      <Heading depth={2}>{heading()}</Heading>
      <Show when={!busy() && upgradable()}>
        <p class="patient-workspace__note">
          Эти карточки сохранены без шифрования. Зашифруем их ключом этого браузера — карточки и
          файлы останутся на месте.
        </p>
      </Show>
      <Show when={!busy() && noDeviceKey()}>
        <p class="patient-workspace__warning" role="alert">
          Этот браузер не может хранить ключ шифрования, поэтому MiniMed не может зашифровать
          карточки. Они хранятся только на этом устройстве, но открыть их сможет любой, у кого есть
          доступ к этому браузеру. Для реальных пациентов используйте приложение для Android — там
          данные шифруются.
        </p>
      </Show>
      <Show when={error()}>
        <p class="patient-workspace__error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={!busy() && firstUse()}>
        <Button type="button" variant="primary" onClick={() => void createEncrypted()}>
          Повторить
        </Button>
      </Show>
      <Show when={!busy() && upgradable()}>
        <Button type="button" variant="primary" onClick={() => void encryptExisting()}>
          Зашифровать и открыть
        </Button>
      </Show>
      <Show when={!busy() && storedMode() === 'unencrypted' && error()}>
        <Button type="button" variant="quiet" onClick={() => void continueUnencrypted()}>
          Открыть без шифрования
        </Button>
      </Show>
      <Show when={!busy() && noDeviceKey() && storedMode() !== 'unencrypted'}>
        <Button type="button" variant="primary" onClick={() => void continueUnencrypted()}>
          Продолжить без шифрования
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
