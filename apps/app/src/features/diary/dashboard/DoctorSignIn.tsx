import { createResource, createSignal, type JSX, Match, Show, Switch } from 'solid-js';

import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import {
  type DoctorSession,
  recoverAccount,
  signIn,
  signUp,
  signUpMode,
} from '@/features/diary/connected/doctor-account';
import { SignInGarden } from '@/features/diary/dashboard/SignInGarden';

type Mode = 'login' | 'register' | 'recover';

const HEADLINES: Readonly<Record<Mode, { readonly title: string; readonly lead: string }>> = {
  login: { title: 'С возвращением!', lead: 'Дневники пациентов уже ждут' },
  register: { title: 'Добро пожаловать!', lead: 'Пара полей — и можно заводить первого пациента' },
  recover: { title: 'Без паники', lead: 'Код восстановления вернёт доступ к пациентам' },
};

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/** A heartbeat trace drawing itself across the card, again and again. */
function Pulse(): JSX.Element {
  return (
    <svg class="diary-signin__pulse" viewBox="0 0 240 40" aria-hidden="true">
      <path
        class="diary-signin__pulse-line"
        d="M0 22 H70 L82 22 L90 6 L100 36 L110 14 L118 22 H150 L158 18 L164 22 H240"
        pathLength="100"
      />
    </svg>
  );
}

/**
 * Sign-in to the diary service, centred, with a little life in it. The password unlocks the
 * doctor's keys on this device and is never sent; «Мой компьютер» keeps the unlocked keys here
 * (IndexedDB, non-extractable key).
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
  const [copied, setCopied] = createSignal(false);
  const [recovery, setRecovery] = createSignal<{ code: string; session: DoctorSession }>();
  // Open sign-up needs no invite code; while unknown (offline) the field stays, as before.
  const [signup] = createResource(() =>
    signUpMode().catch((cause: unknown) => {
      console.warn('Дневники: режим регистрации не получен', cause);
      return 'invite' as const;
    }),
  );

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
    <section class="diary-signin" aria-label="Вход в дневники пациентов">
      <div class="diary-signin__stage">
        <SignInGarden />
      </div>
      <div class="diary-signin__card">
        <img
          class="diary-signin__logo"
          src={`${import.meta.env.BASE_URL}boot-icon.png`}
          alt=""
          width="56"
          height="56"
        />
        <Pulse />
        <Show
          when={recovery()}
          fallback={
            <form class="diary-signin__form" onSubmit={(event) => void submit(event)}>
              <Show when={mode()} keyed>
                {(current) => (
                  <div class="diary-signin__headline">
                    <h1 class="diary-signin__title">{HEADLINES[current].title}</h1>
                    <p class="diary-signin__lead">{HEADLINES[current].lead}</p>
                  </div>
                )}
              </Show>
              <Show when={mode() !== 'recover'}>
                <SegmentedControl
                  label="Вход или регистрация"
                  stretch
                  value={mode() === 'register' ? 'register' : 'login'}
                  options={[
                    { value: 'login', label: 'Вход' },
                    { value: 'register', label: 'Регистрация' },
                  ]}
                  onChange={(next) => {
                    setMode(next);
                    setError('');
                  }}
                />
              </Show>
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
                <Show when={signup.latest !== 'open'}>
                  <TextField
                    label="Код приглашения"
                    placeholder="Из письма или сообщения"
                    value={invite()}
                    onInput={(event) => setInvite(event.currentTarget.value)}
                  />
                </Show>
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
              <Button
                type="submit"
                variant="primary"
                disabled={busy()}
                class="diary-signin__submit"
                classList={{ 'diary-signin__submit--busy': busy() }}
              >
                <Switch>
                  <Match when={busy()}>Открываем ключи…</Match>
                  <Match when={mode() === 'login'}>Войти</Match>
                  <Match when={mode() === 'register'}>Создать аккаунт</Match>
                  <Match when={mode() === 'recover'}>Восстановить доступ</Match>
                </Switch>
              </Button>
              <Show when={mode() !== 'register'}>
                <button
                  type="button"
                  class="diary-signin__switch"
                  onClick={() => {
                    setMode(mode() === 'recover' ? 'login' : 'recover');
                    setError('');
                  }}
                >
                  {mode() === 'recover' ? 'Вспомнили пароль? Войти' : 'Забыли пароль?'}
                </button>
              </Show>
            </form>
          }
        >
          {(created) => (
            <div class="diary-signin__form">
              <div class="diary-signin__headline">
                <h1 class="diary-signin__title">
                  <span class="diary-signin__key" aria-hidden="true">
                    🔑
                  </span>{' '}
                  Ваш код восстановления
                </h1>
                <p class="diary-signin__lead">
                  Единственный способ войти без пароля. Сервер не видит ваши данные и восстановить
                  их не сможет — сохраните код.
                </p>
              </div>
              <p class="diary-signin__code">{created().code}</p>
              <Button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(created().code).then(() => setCopied(true))
                }
              >
                {copied() ? 'Скопировано ✓' : 'Скопировать'}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => props.onSignedIn(created().session)}
              >
                Я сохранил(а) код
              </Button>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
