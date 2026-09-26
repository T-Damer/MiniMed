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
  return (
    <section class="patient-workspace__unlock paper-card">
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
}
