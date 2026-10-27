import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';

import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import {
  type DoctorSession,
  recoverAccount,
  signIn,
  signUp,
} from '@/features/diary/connected/doctor-account';

type Mode = 'login' | 'register' | 'recover';

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * Sign-in to the diary service. The password unlocks the doctor's keys on this device and is
 * never sent; «Мой компьютер» keeps the unlocked keys here (IndexedDB, non-extractable key).
 */
export function DoctorSignIn(props: {
  readonly onSignedIn: (session: DoctorSession) => void;
}): JSX.Element {
  const [mode, setMode] = createSignal<Mode>('login');
  const [email, setEmail] = createSignal('');
  const [name, setName] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [code, setCode] = createSignal('');
  const [invite, setInvite] = createSignal('');
  const [remember, setRemember] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [recovery, setRecovery] = createSignal<{ code: string; session: DoctorSession }>();

  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode() === 'login') {
        props.onSignedIn(
          await signIn({ email: email(), password: password(), rememberDevice: remember() }),
        );
      } else if (mode() === 'register') {
        const result = await signUp({
          email: email(),
          name: name(),
          password: password(),
          invite: invite(),
          rememberDevice: remember(),
        });
        setRecovery({ code: result.recoveryCode, session: result.session });
      } else {
        props.onSignedIn(
          await recoverAccount({
            email: email(),
            code: code(),
            password: password(),
            rememberDevice: remember(),
          }),
        );
      }
    } catch (cause) {
      setError(message(cause, 'Не получилось. Проверьте адрес и пароль.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show
      when={recovery()}
      fallback={
        <form class="diary-signin" onSubmit={(event) => void submit(event)}>
          <SegmentedControl
            label="Вход"
            stretch
            value={mode()}
            options={[
              { value: 'login', label: 'Вход' },
              { value: 'register', label: 'Регистрация' },
              { value: 'recover', label: 'Восстановить' },
            ]}
            onChange={(next) => {
              setMode(next);
              setError('');
            }}
          />
          <TextField
            label="Почта"
            type="email"
            autocomplete="username"
            required
            value={email()}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
          <Show when={mode() === 'register'}>
            <TextField
              label="Как вас подписать для пациентов"
              placeholder="Д-р Иванова А. С."
              required
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
            <TextField
              label="Код приглашения"
              placeholder="Если сервер просит"
              value={invite()}
              onInput={(event) => setInvite(event.currentTarget.value)}
            />
          </Show>
          <Show when={mode() === 'recover'}>
            <TextField
              label="Код восстановления"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              required
              value={code()}
              onInput={(event) => setCode(event.currentTarget.value)}
            />
          </Show>
          <TextField
            label={mode() === 'login' ? 'Пароль' : 'Новый пароль (от 8 символов)'}
            type="password"
            autocomplete={mode() === 'login' ? 'current-password' : 'new-password'}
            minLength={8}
            required
            value={password()}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
          <Checkbox
            label="Мой компьютер: не спрашивать пароль снова"
            checked={remember()}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          <Show when={error()}>
            <p class="diary-signin__error" role="alert">
              {error()}
            </p>
          </Show>
          <Button type="submit" variant="primary" disabled={busy()} class="diary-signin__submit">
            <Switch>
              <Match when={busy()}>Проверяем…</Match>
              <Match when={mode() === 'login'}>Войти</Match>
              <Match when={mode() === 'register'}>Создать аккаунт</Match>
              <Match when={mode() === 'recover'}>Восстановить доступ</Match>
            </Switch>
          </Button>
        </form>
      }
    >
      {(created) => (
        <section class="diary-signin" aria-label="Код восстановления">
          <p class="diary-signin__lead">
            Запишите код восстановления. Без пароля и этого кода данные пациентов не открыть: сервер
            их не видит и восстановить не может.
          </p>
          <p class="diary-signin__code">{created().code}</p>
          <Button type="button" onClick={() => void navigator.clipboard.writeText(created().code)}>
            Скопировать
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => props.onSignedIn(created().session)}
          >
            Я записал(а) код
          </Button>
        </section>
      )}
    </Show>
  );
}
