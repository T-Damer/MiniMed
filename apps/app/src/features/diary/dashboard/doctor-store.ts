/**
 * The signed-in doctor's workspace for the whole life of the page (owner 2026-11-03: coming back
 * to the list must not load it again). The dashboard mounts and unmounts as the doctor moves between
 * tabs; the session, the decrypted patients and the live connection live here instead, one
 * `DoctorDiaries` per signed-in doctor, until sign-out. A dashboard that mounts finds the list
 * already there and only asks for a quiet refresh.
 */
import { createSignal } from 'solid-js';

import { DiaryApiError } from '@/features/diary/connected/diary-api';
import {
  type DoctorSession,
  forgetDoctorSession,
  isDemoSession,
  restoreDoctorSession,
  signOut,
} from '@/features/diary/connected/doctor-account';
import { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import {
  hasDemoSet,
  pruneDemoGuests,
  seedDemoPatients,
  staleDemoPatients,
} from '@/features/diary/dashboard/demo-patients';
import { enableDoctorPush, type PushState } from '@/features/diary/dashboard/doctor-push';
import { warmQuestionnaires } from '@/features/diary/diary-questionnaires';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';

export type PushUiState = 'off' | PushState;

const [session, setSession] = createSignal<DoctorSession | undefined>();
const [workspace, setWorkspace] = createSignal<DoctorDiaries | undefined>();
const [version, setVersion] = createSignal(0);
const [restored, setRestored] = createSignal(false);
const [loadError, setLoadError] = createSignal('');
const [demoStatus, setDemoStatus] = createSignal('');
const [pushState, setPushState] = createSignal<PushUiState>('off');

/** The signed-in doctor; undefined until a kept session is restored or the doctor signs in. */
export const doctorSession = session;
/** The doctor's workspace; one per signed-in doctor, kept across route changes. */
export const doctorWorkspace = workspace;
/** Counts every change of the workspace: read it inside a memo to follow the patients. */
export const doctorVersion = version;
/** Whether the session kept on this device has been looked for. */
export const doctorRestored = restored;
/** Why the first read, or the demo set, failed. */
export const doctorLoadError = loadError;
/** Progress of the demo patients being made; empty when nothing is. */
export const demoProgress = demoStatus;
export const doctorPushState = pushState;
export const setDoctorPushState = setPushState;

/** Diaries whose questionnaires are already asked for. */
const warmed = new WeakSet<object>();
let warmTimer: number | undefined;

/**
 * Loads the questionnaire definitions the doctor's diaries use, once the page is idle: the patient
 * page scores answers with them, and with them at hand it draws at once instead of waiting a tick.
 */
function warmQuestionnairesLater(diaries: DoctorDiaries): void {
  if (warmTimer !== undefined) return;
  warmTimer = window.setTimeout(() => {
    warmTimer = undefined;
    for (const patient of diaries.patients()) {
      const invitation = patient.replica.invitation;
      if (!invitation || warmed.has(invitation)) continue;
      warmed.add(invitation);
      warmQuestionnaires(invitation.checkpoints);
    }
  }, 1500);
}

let stopCurrent: (() => void) | undefined;
let restoring: Promise<void> | undefined;

/** Makes the demo patients of the doctor's account, with their progress on `demoProgress`. */
export function addDemoPatients(diaries: DoctorDiaries): void {
  setLoadError('');
  setDemoStatus('Готовим демо-пациентов…');
  seedDemoPatients(diaries, {
    onProgress: (text) => {
      setDemoStatus(text);
    },
  })
    .then(() => playFeedback(...FEEDBACK_MOMENTS.saved))
    .catch((cause: unknown) => {
      playFeedback(...FEEDBACK_MOMENTS.failed);
      setLoadError(cause instanceof Error ? cause.message : 'Не удалось добавить демо-пациентов.');
    })
    .finally(() => setDemoStatus(''));
}

/** Tears the workspace down: its live connection closes and the dashboard shows the sign-in. */
export function stopDoctor(): void {
  stopCurrent?.();
  stopCurrent = undefined;
  window.clearTimeout(warmTimer);
  warmTimer = undefined;
  setWorkspace(undefined);
  setSession(undefined);
  setVersion(0);
  setLoadError('');
  setDemoStatus('');
  setPushState('off');
}

/** The first read of a session is over: live updates, the demo doctor's set and its upkeep. */
function afterFirstRead(next: DoctorSession, diaries: DoctorDiaries): void {
  diaries.connectLive();
  if (isDemoSession(next)) void keepDemoSet(diaries);
}

/**
 * The demo doctor finds the demo patients already there (owner 2026-11-02), made within the last
 * day (owner 2026-11-04); the shared demo account keeps its guests a day, then lets them go.
 */
async function keepDemoSet(diaries: DoctorDiaries): Promise<void> {
  const stale = staleDemoPatients(diaries);
  if (stale.length) setDemoStatus('Обновляем демо-пациентов…');
  for (const id of stale) {
    // Another visitor may be renewing the set at the same moment: a patient already gone is fine.
    await diaries.removePatient(id).catch((cause: unknown) => {
      console.warn('Демо: пациент не убран', cause);
    });
  }
  if (stale.length) {
    await diaries.refresh().catch((cause: unknown) => {
      console.warn('Демо: список пациентов не обновлён', cause);
    });
  }
  const seeded = hasDemoSet(diaries.patients().map((patient) => patient.replica.profile?.label));
  if (seeded) setDemoStatus('');
  else addDemoPatients(diaries);
  await pruneDemoGuests(diaries).catch((cause: unknown) => {
    console.warn('Демо: старые гостевые дневники не убраны', cause);
  });
}

/**
 * Opens the workspace of a signed-in doctor and reads the patients; the list shows what is known
 * (the copy kept on this device) while the service answers. The same session twice gives the same
 * workspace.
 */
export function startDoctor(next: DoctorSession): DoctorDiaries {
  const running = workspace();
  if (running && running.session.token === next.token) return running;
  stopDoctor();
  setSession(next);
  const diaries = new DoctorDiaries(next);
  const unsubscribe = diaries.subscribe(() => {
    setVersion((value) => value + 1);
    warmQuestionnairesLater(diaries);
  });
  stopCurrent = () => {
    unsubscribe();
    diaries.disconnect();
  };
  setWorkspace(diaries);
  // Allowed on an earlier visit: re-send the subscription with its payload keys, no prompt.
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    void enableDoctorPush(next).then(setPushState, (cause: unknown) => {
      console.warn('Дневники: подписка на уведомления не обновлена', cause);
    });
  }
  diaries
    .refresh()
    .then(() => {
      // Signed out, or signed in as someone else, while the list was loading.
      if (workspace() === diaries) afterFirstRead(next, diaries);
    })
    .catch((cause: unknown) => {
      if (workspace() !== diaries) return;
      // The kept session expired on the server: back to the sign-in, not a list that never loads.
      if (cause instanceof DiaryApiError && cause.status === 401) {
        console.warn('Дневники: сохранённый вход больше не действует');
        forgetDoctorSession();
        stopDoctor();
        return;
      }
      setLoadError(cause instanceof Error ? cause.message : 'Не удалось загрузить дневники.');
    });
  return diaries;
}

/** Looks for the session kept on this device, once; a found one is started. */
export function restoreDoctor(): Promise<void> {
  restoring ??= (async () => {
    const found = await restoreDoctorSession().catch((cause: unknown) => {
      console.warn('Дневники: сохранённый вход не открылся', cause);
      return undefined;
    });
    // The doctor may have signed in by hand while the kept session was being opened.
    if (found && !session()) startDoctor(found);
    setRestored(true);
  })();
  return restoring;
}

/** Signs out on the service and takes this device's keys, copy and workspace away. */
export function leaveDoctor(): void {
  const current = session();
  if (!current) return;
  void signOut(current)
    .catch((cause: unknown) => {
      console.warn('Дневники: выход на сервере не удался', cause);
    })
    .finally(stopDoctor);
}
