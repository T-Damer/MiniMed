import { createResource, createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';

import { claimFullScreen } from '@/app/full-screen-routes';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { NavBack } from '@/components/NavBack';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import {
  type DoctorSession,
  readAccessCode,
  recoverAccount,
  signIn,
  signInDemo,
  signInWithCode,
  signUp,
  signUpMode,
} from '@/features/diary/connected/doctor-account';
import { ServicePrivacyLink } from '@/features/diary/consent/ServicePrivacyLink';
import { SERVICE_PRIVACY_VERSION } from '@/features/diary/consent/service-privacy';
import { SignInGarden } from '@/features/diary/dashboard/SignInGarden';
import { getClinicianProfile, setClinicianProfile } from '@/state/clinician-profile';

type Mode = 'login' | 'register' | 'recover';

const MODES: readonly Mode[] = ['login', 'register', 'recover'];

const HEADLINES: Readonly<Record<Mode, { readonly title: string; readonly lead: string }>> = {
  login: { title: 'С возвращением!', lead: 'Дневники пациентов уже ждут' },
  register: {
    title: 'Добро пожаловать!',
    lead: 'Пара полей — и можно заводить первого пациента',
  },
  recover: {
    title: 'Без паники',
    lead: 'Код восстановления вернёт доступ к пациентам',
  },
};

/**
 * `?demo` in the address (the doctor's QR code on the slides): the form opens on «Регистрация» with
 * the demo button in front — one tap and the visitor is in (owner 2026-11-02: no demo tab).
 */
function demoRequested(): boolean {
  return new URLSearchParams(window.location.search).has('demo');
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * Fields that come and go with the mode: always mounted, they fold to nothing and fade, so the card
 * grows and shrinks smoothly instead of jumping (AGENTS.md «Motion»). Folded, they take no input.
 */
function Reveal(props: { readonly open: boolean; readonly children: JSX.Element }): JSX.Element {
  return (
    <div
      class="diary-signin__reveal"
      classList={{ 'diary-signin__reveal--open': props.open }}
      inert={!props.open}
      aria-hidden={props.open ? undefined : 'true'}
    >
      <div class="diary-signin__reveal-body">{props.children}</div>
    </div>
  );
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
 * Sign-in to the diary service, centred, with a little life in it: the whole screen while the
 * doctor is out. The password unlocks the doctor's keys on this device and is never sent;
 * «Мой компьютер» keeps the unlocked keys here (IndexedDB, non-extractable key). The first field
 * also takes an access code: typed in full, the password folds away and the code alone signs in.
 */
export function DoctorSignIn(props: {
  /** May wait for the app to load (the diaries copy): the busy button holds until it is done. */
  readonly onSignedIn: (session: DoctorSession) => void | Promise<void>;
  /** The way back in the full app; the diaries-only app has nowhere to go. */
  readonly onBack?: (() => void) | undefined;
}): JSX.Element {
  claimFullScreen();
  const [mode, setMode] = createSignal<Mode>(demoRequested() ? 'register' : 'login');
  const [email, setEmail] = createSignal('');
  const [name, setName] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [code, setCode] = createSignal('');
  const [invite, setInvite] = createSignal('');
  const [remember, setRemember] = createSignal(true);
  // 152-ФЗ ст. 9: unchecked until the doctor ticks it; a separate box, not part of other text.
  const [consent, setConsent] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [recovery, setRecovery] = createSignal<{
    code: string;
    session: DoctorSession;
  }>();
  // Open sign-up needs no invite code; while unknown (offline) the field stays, as before.
  const [signup] = createResource(() =>
    signUpMode().catch((cause: unknown) => {
      console.warn('Дневники: режим регистрации не получен', cause);
      return 'invite' as const;
    }),
  );
  /** Signing in with an access code typed in full into the first field. */
  const byCode = (): boolean => mode() === 'login' && readAccessCode(email()) !== undefined;
  const choose = (next: Mode): void => {
    setMode(next);
    setError('');
  };

  /** The fields the chosen form needs are there: until then «Войти» stays off. */
  const filled = (): boolean => {
    if (byCode()) return true;
    const strong = password().length >= 8;
    if (mode() === 'login') return email().trim() !== '' && password() !== '';
    if (mode() === 'register') {
      return (
        email().trim() !== '' &&
        name().trim() !== '' &&
        strong &&
        (signup.latest === 'open' || invite().trim() !== '') &&
        consent()
      );
    }
    return email().trim() !== '' && code().trim() !== '' && strong;
  };

  /** «Демо»: the shared demo account, no e-mail, password or code. */
  const openDemo = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      await props.onSignedIn(await signInDemo({ rememberDevice: true }));
    } catch (cause) {
      setError(message(cause, 'Демо сейчас недоступно.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (byCode()) {
        await props.onSignedIn(
          await signInWithCode({
            code: email(),
            rememberDevice: remember(),
            // A first use of a real code creates an account: it needs the ticked consent.
            ...(consent() ? { privacyVersion: SERVICE_PRIVACY_VERSION } : {}),
          }),
        );
      } else if (mode() === 'login') {
        await props.onSignedIn(
          await signIn({
            email: email(),
            password: password(),
            rememberDevice: remember(),
          }),
        );
      } else if (mode() === 'register') {
        const result = await signUp({
          email: email(),
          name: name(),
          password: password(),
          invite: invite(),
          privacyVersion: SERVICE_PRIVACY_VERSION,
          rememberDevice: remember(),
        });
        setRecovery({ code: result.recoveryCode, session: result.session });
        // The name the doctor just typed also signs their forms, unless one is already set.
        if (!getClinicianProfile().clinicianFullName?.trim()) {
          // «Д-р Иванова А. С.» signs for patients; a form wants the name without the title.
          const fullName = name()
            .trim()
            .replace(/^(?:д-р|др\.?|доктор)\s+/iu, '');
          setClinicianProfile({ clinicianFullName: fullName });
        }
      } else {
        await props.onSignedIn(
          await recoverAccount({
            email: email(),
            code: code(),
            password: password(),
            rememberDevice: remember(),
          }),
        );
      }
    } catch (cause) {
      setError(
        message(
          cause,
          byCode() ? 'Не получилось войти по коду.' : 'Не получилось. Проверьте адрес и пароль.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      class="diary-signin"
      classList={{ 'diary-signin--back': Boolean(props.onBack) }}
      aria-label="Вход в дневники пациентов"
    >
      <div class="diary-signin__stage">
        <SignInGarden />
      </div>
      <Show when={props.onBack}>
        {(back) => (
          <div class="diary-signin__top">
            <NavBack class="knowledge-back-button" aria-label="Назад" onClick={back()} />
          </div>
        )}
      </Show>
      <div class="diary-signin__card">
        <img
          class="diary-signin__logo"
          src={`${import.meta.env.BASE_URL}diaries/icon-192.png`}
          alt=""
          width="56"
          height="56"
        />
        <Pulse />
        <Show
          when={recovery()}
          fallback={
            <form class="diary-signin__form" onSubmit={(event) => void submit(event)}>
              {/* All three headlines share one cell and cross-fade: the card never re-mounts. */}
              <div class="diary-signin__headlines">
                <For each={MODES}>
                  {(each) => (
                    <div
                      class="diary-signin__headline diary-signin__headline--stacked"
                      classList={{
                        'diary-signin__headline--hidden': mode() !== each,
                      }}
                      aria-hidden={mode() === each ? undefined : 'true'}
                    >
                      <h1 class="diary-signin__title">{HEADLINES[each].title}</h1>
                      <p class="diary-signin__lead">{HEADLINES[each].lead}</p>
                    </div>
                  )}
                </For>
              </div>
              <Reveal open={mode() !== 'recover'}>
                <SegmentedControl
                  label="Вход или регистрация"
                  stretch
                  value={mode() === 'register' ? 'register' : 'login'}
                  options={[
                    { value: 'login', label: 'Вход' },
                    { value: 'register', label: 'Регистрация' },
                  ]}
                  onChange={choose}
                />
              </Reveal>
              <TextField
                label={mode() === 'login' ? 'Почта или код доступа' : 'Почта'}
                // Text, not e-mail: the same field takes «K2CM-R5AG-2M4R».
                type={mode() === 'login' ? 'text' : 'email'}
                inputMode="email"
                autocomplete="username"
                autocapitalize="off"
                spellcheck={false}
                required
                value={email()}
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
              <Reveal open={mode() === 'register'}>
                <TextField
                  label="Как вас подписать для пациентов"
                  placeholder="Д-р Иванова А. С."
                  required={mode() === 'register'}
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </Reveal>
              <Reveal open={mode() === 'register' && signup.latest !== 'open'}>
                <TextField
                  label="Код приглашения"
                  placeholder="Из письма или сообщения"
                  value={invite()}
                  onInput={(event) => setInvite(event.currentTarget.value)}
                />
              </Reveal>
              <Reveal open={mode() === 'recover'}>
                <TextField
                  label="Код восстановления"
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  required={mode() === 'recover'}
                  value={code()}
                  onInput={(event) => setCode(event.currentTarget.value)}
                />
              </Reveal>
              <Reveal open={!byCode()}>
                <TextField
                  label={mode() === 'login' ? 'Пароль' : 'Новый пароль (от 8 символов)'}
                  type="password"
                  autocomplete={mode() === 'login' ? 'current-password' : 'new-password'}
                  minLength={8}
                  required={!byCode()}
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
              </Reveal>
              <Reveal open={mode() === 'register' || byCode()}>
                <Checkbox
                  label={
                    <>
                      Согласен(на) на обработку моих персональных данных по{' '}
                      <ServicePrivacyLink>Политике</ServicePrivacyLink>
                    </>
                  }
                  hint={byCode() ? 'Нужно при первом входе по этому коду' : undefined}
                  checked={consent()}
                  onChange={(event) => setConsent(event.currentTarget.checked)}
                />
              </Reveal>
              <Checkbox
                label={`Мой компьютер: не спрашивать ${byCode() ? 'код' : 'пароль'} снова`}
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
                disabled={busy() || !filled()}
                class="diary-signin__submit"
                classList={{ 'diary-signin__submit--busy': busy() }}
              >
                <Switch>
                  <Match when={busy()}>Открываем ключи…</Match>
                  <Match when={byCode()}>Войти по коду</Match>
                  <Match when={mode() === 'login'}>Войти</Match>
                  <Match when={mode() === 'register'}>Создать аккаунт</Match>
                  <Match when={mode() === 'recover'}>Восстановить доступ</Match>
                </Switch>
              </Button>
              <Reveal open={mode() !== 'register' && !byCode()}>
                <button
                  type="button"
                  class="diary-signin__switch"
                  onClick={() => choose(mode() === 'recover' ? 'login' : 'recover')}
                >
                  {mode() === 'recover' ? 'Вспомнили пароль? Войти' : 'Забыли пароль?'}
                </button>
              </Reveal>
              {/* Try the diaries before any account: needs a service with open sign-up. In front while
                  the account fields are empty; once they are filled, the submit button takes over. */}
              <Reveal open={mode() !== 'recover' && (signup.latest === 'open' || demoRequested())}>
                <Button
                  type="button"
                  variant={filled() ? 'secondary' : 'primary'}
                  class="diary-signin__demo"
                  icon={<AppGlyph name="play" class="diary-signin__demo-icon" />}
                  disabled={busy()}
                  onClick={() => void openDemo()}
                >
                  Демо — без регистрации
                </Button>
              </Reveal>
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
                disabled={busy()}
                onClick={() => {
                  setBusy(true);
                  void Promise.resolve(props.onSignedIn(created().session))
                    .catch((cause: unknown) => setError(message(cause, 'Дневники не открылись.')))
                    .finally(() => setBusy(false));
                }}
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
