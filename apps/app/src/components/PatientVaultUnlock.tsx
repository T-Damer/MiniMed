import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Heading } from '@/components/Text';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  createPatientVault,
  patientVaultStorageMode,
  readPatientVault,
  unlockPatientVault,
} from '@/state/patient-vault';
import { isPatientVaultNativePlatform } from '@/state/patient-vault-native';
import { passkeyPrfSupport } from '@/state/patient-vault-passkey';
import '@/styles/patient-workspace.css';

export function PatientVaultUnlock(props: {
  readonly onUnlocked: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  let current = true;
  onCleanup(() => {
    current = false;
  });
  const unlocked = (snapshot: PatientVaultSnapshot): void => {
    if (current) props.onUnlocked(snapshot);
  };
  const [storedMode, setStoredMode] =
    createSignal<Awaited<ReturnType<typeof patientVaultStorageMode>>>();
  const [busy, setBusy] = createSignal(true);
  const [error, setError] = createSignal('');
  onMount(() => {
    void (async () => {
      try {
        const mode = await patientVaultStorageMode();
        setStoredMode(mode);
        // Browsers only run WebAuthn from a tap, so web vaults wait for the doctor's choice.
        if (
          mode === 'unencrypted' ||
          mode === 'passkey' ||
          (!mode && !isPatientVaultNativePlatform())
        )
          return;
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
      }
    })();
  });
  const [passkeySupport, setPasskeySupport] =
    createSignal<Awaited<ReturnType<typeof passkeyPrfSupport>>>('unknown');
  onMount(() => {
    void passkeyPrfSupport().then(setPasskeySupport);
  });
  const run = async (action: () => Promise<PatientVaultSnapshot>): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      unlocked(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть хранилище.');
    } finally {
      setBusy(false);
    }
  };
  const protectWithPasskey = (): Promise<void> =>
    run(async () => {
      await createPatientVault({ passkey: true });
      return readPatientVault();
    });
  const continueUnprotected = (): Promise<void> =>
    run(async () => {
      if (storedMode() === 'unencrypted') return unlockPatientVault();
      await createPatientVault({ allowUnencrypted: true });
      return readPatientVault();
    });
  const openWithPasskey = (): Promise<void> => run(unlockPatientVault);
  const firstRun = (): boolean => !storedMode() && !isPatientVaultNativePlatform();
  return (
    <section class="patient-workspace__unlock paper-card">
      <AppGlyph name="lock" class="patient-workspace__unlock-icon" />
      <Heading depth={2}>
        {busy()
          ? 'Открываем пациентов…'
          : firstRun()
            ? 'Защитите карточки пациентов'
            : storedMode() === 'unencrypted' || storedMode() === 'passkey'
              ? 'Пациенты закрыты'
              : 'Не удалось открыть защищённое хранилище'}
      </Heading>
      <Show when={!busy() && firstRun()}>
        <p class="patient-workspace__unlock-text">
          Карточки хранятся только на этом устройстве. Passkey зашифрует их: открыть сможете только
          вы — лицом, отпечатком, Windows Hello, телефоном или менеджером паролей вроде Bitwarden.
        </p>
        <Button
          type="button"
          variant="primary"
          disabled={passkeySupport() === 'unsupported'}
          onClick={() => void protectWithPasskey()}
        >
          Защитить через passkey
        </Button>
        <Show when={passkeySupport() === 'unsupported'}>
          <p class="patient-workspace__unlock-text">
            Этот браузер не умеет шифровать данные через passkey. Откройте MiniMed в свежем Chrome,
            Edge или Safari либо используйте приложение для Android.
          </p>
        </Show>
        <Button type="button" variant="quiet" onClick={() => void continueUnprotected()}>
          Продолжить без защиты
        </Button>
        <p class="patient-workspace__warning">
          Без защиты карточки откроет любой, у кого есть доступ к этому браузеру. Подходит для
          пробы, не для реальных пациентов.
        </p>
      </Show>
      <Show when={!busy() && storedMode() === 'passkey'}>
        <Button type="button" variant="primary" onClick={() => void openWithPasskey()}>
          Открыть по passkey
        </Button>
      </Show>
      <Show when={!busy() && storedMode() === 'unencrypted'}>
        <p class="patient-workspace__unlock-text">Карточки на этом устройстве без шифрования.</p>
        <Button type="button" variant="primary" onClick={() => void continueUnprotected()}>
          Открыть
        </Button>
      </Show>
      <Show when={error()}>
        <p class="patient-workspace__error" role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
}
