import { createSignal, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { DoctorSession } from '@/features/diary/connected/doctor-account';
import { enableDoctorPush, type PushState } from '@/features/diary/dashboard/doctor-push';

function platform(): 'ios' | 'android' | 'desktop' {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/u.test(agent)) return 'ios';
  if (/Android/u.test(agent)) return 'android';
  return 'desktop';
}

/**
 * Urgent alerts need the browser's permission. When it was refused (or the browser cannot show
 * notifications here) the doctor sees how to turn them on for this device and can ask again.
 */
export function PushHelpDialog(props: {
  readonly session: DoctorSession;
  readonly state: PushState | 'off';
  readonly onState: (state: PushState) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const where = platform();
  const retry = (): void => {
    setBusy(true);
    setError('');
    enableDoctorPush(props.session)
      .then((next) => {
        props.onState(next);
        if (next === 'on') props.onClose();
        else setError('Браузер всё ещё не разрешает уведомления.');
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Не получилось включить уведомления.'),
      )
      .finally(() => setBusy(false));
  };
  return (
    <OverlayDialog
      open
      title="Уведомления о срочном"
      subtitle={
        props.state === 'unsupported' ? 'Здесь браузер их не показывает' : 'Сейчас запрещены'
      }
      class="diary-dash-dialog"
      onClose={props.onClose}
    >
      <div class="diary-push-help">
        <Show when={where === 'ios'}>
          <ol class="diary-push-help__steps">
            <li class="diary-push-help__step">В Safari: «Поделиться» → «На экран „Домой“».</li>
            <li class="diary-push-help__step">Откройте дневники со значка на экране.</li>
            <li class="diary-push-help__step">Нажмите «Проверить снова» и разрешите.</li>
          </ol>
        </Show>
        <Show when={where === 'android'}>
          <ol class="diary-push-help__steps">
            <li class="diary-push-help__step">
              Значок замка слева от адреса → «Разрешения» → «Уведомления» → «Разрешить».
            </li>
            <li class="diary-push-help__step">
              Для установленного приложения: долгое нажатие на значок → «О приложении» →
              «Уведомления».
            </li>
            <li class="diary-push-help__step">Вернитесь и нажмите «Проверить снова».</li>
          </ol>
        </Show>
        <Show when={where === 'desktop'}>
          <ol class="diary-push-help__steps">
            <li class="diary-push-help__step">
              Значок слева от адреса сайта → «Уведомления» → «Разрешить».
            </li>
            <li class="diary-push-help__step">Нажмите «Проверить снова».</li>
          </ol>
        </Show>
        <Show when={error()}>
          <p class="diary-dash__error" role="alert">
            {error()}
          </p>
        </Show>
        <Button type="button" variant="primary" disabled={busy()} onClick={retry}>
          {busy() ? 'Проверяем…' : 'Проверить снова'}
        </Button>
      </div>
    </OverlayDialog>
  );
}
