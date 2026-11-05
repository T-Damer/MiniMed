/**
 * The diaries copy's start (DIARY24, owner 2026-11-04: «the first open should fetch only the
 * sign-in; once signed in, the whole app at once, no loading later»). With nobody in, the page is
 * the sign-in alone and its code is all the page loads. Signing in loads the app and the patient
 * list's code while the sign-in keeps its busy button, then mounts it; the service worker stores
 * the rest of the app, and the app reads its other tabs in while the page is idle. A doctor kept
 * signed in on this device, or an address outside the diaries, gets the app at once.
 *
 * vite.config.ts (`diariesEntry`) puts this module in place of `app/mount-app.tsx` in that build.
 */
import { type Component, createSignal, type JSX, Show } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';

import { firstScreenPainted, revealFromBootSurface } from '@/app/boot-surface';
import { diariesAddress } from '@/app/diaries-address';
import type { DoctorSession } from '@/features/diary/connected/doctor-account';
import { hasKeptDoctorSession } from '@/features/diary/connected/doctor-account';
import { DoctorSignIn } from '@/features/diary/dashboard/DoctorSignIn';
import { activeProfile } from '@/state/app-profile';
import { cacheWholeApp } from '@/state/app-update';

import '@/styles/notes-root.css';
import '@/features/diary/dashboard/diary-dashboard.css';

let app: Promise<Component> | undefined;

/** The app and the screens the patient list needs, loaded together once. */
function loadApp(): Promise<Component> {
  app ??= Promise.all([
    import('@/app/App'),
    import('@/features/notes/NotesView'),
    import('@/features/diary/dashboard/DiaryDashboard'),
  ]).then(([{ App }]) => App);
  return app;
}

export function mountApp(root: HTMLElement): void {
  render(() => <DiariesStart />, root);
}

function DiariesStart(): JSX.Element {
  const [loaded, setLoaded] = createSignal<Component>();
  const open = async (): Promise<void> => {
    const App = await loadApp();
    // The bare page is the diaries' home: the app starts on it, not on the search it would warm
    // first and leave at once.
    const home = activeProfile()?.home;
    if (home && /^#?\/?$/u.test(window.location.hash)) window.history.replaceState(null, '', home);
    setLoaded(() => App);
    cacheWholeApp();
  };
  const signIn = !hasKeptDoctorSession() && diariesAddress(window.location.hash);
  if (signIn) {
    // The app reveals itself when it mounts; the sign-in does it here, once it has painted.
    void firstScreenPainted([document.fonts.ready]).then(() => revealFromBootSurface());
  } else {
    void open().catch((cause: unknown) => {
      console.error('Дневники не открылись.', cause);
    });
  }
  const signedIn = async (session: DoctorSession): Promise<void> => {
    const [{ startDoctor }] = await Promise.all([
      import('@/features/diary/dashboard/doctor-store'),
      loadApp(),
    ]);
    startDoctor(session);
    await open();
  };
  return (
    <Show
      when={loaded()}
      fallback={<Show when={signIn}>{<SignInPage onSignedIn={signedIn} />}</Show>}
    >
      {(App) => <Dynamic component={App()} />}
    </Show>
  );
}

/** The sign-in as the app shows it with nobody in: the whole screen, in the app's own frames. */
function SignInPage(props: {
  readonly onSignedIn: (session: DoctorSession) => Promise<void>;
}): JSX.Element {
  return (
    <div class="app-shell archive-app app-shell--no-nav">
      <main class="app-main">
        <section class="app-view active">
          <section class="patient-notes-view page-surface page-grain">
            <section class="diary-dash diary-dash--signed-out" aria-label="Дневники пациентов">
              <DoctorSignIn onSignedIn={props.onSignedIn} />
            </section>
          </section>
        </section>
      </main>
    </div>
  );
}
