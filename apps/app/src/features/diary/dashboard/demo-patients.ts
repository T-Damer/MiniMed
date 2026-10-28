/**
 * Demo patients for the doctor's dashboard: a few invented psychiatric care diaries with weeks of
 * back-filled marks. The diary is end-to-end encrypted, so the data is written the way a real
 * phone writes it: the doctor creates the patient and a one-time code, a throw-away device (in
 * memory, its own storage — a patient replica of this browser is never touched) pairs with the
 * code, confirms the consent and sends signed, encrypted entries. The server sees nothing else
 * than for a real patient. The invented values come from `demo-diary-data.ts`.
 */

import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import {
  type PairingLink,
  PatientConnection,
  readPairingFragment,
} from '@/features/diary/connected/patient-connection';
import {
  type DemoBehavior,
  demoIssuedAt,
  generateDemoDiary,
  type QuestionnaireShape,
} from '@/features/diary/dashboard/demo-diary-data';
import {
  type CareDraft,
  type CareSectionDraft,
  careInvitation,
  emptyCareDraft,
  newCareSection,
} from '@/features/diary/diary-care-draft';
import {
  DIARY_FORMAT_VERSION,
  type DiaryInvitation,
  type DiaryMeal,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { loadDiaryQuestionnaire } from '@/features/diary/diary-questionnaires';
import { createDiaryStore } from '@/features/diary/diary-storage';

/** Every demo patient's label starts with this; the seeding skips labels that exist. */
export const DEMO_LABEL_PREFIX = 'Демо ·';

export interface DemoPatientSpec extends DemoBehavior {
  readonly label: string;
  readonly emoji: string;
  /** Days of history, today included. */
  readonly days: number;
  readonly draft: () => CareDraft;
}

function drug(input: {
  readonly title: string;
  readonly form: string;
  readonly dose: string;
  readonly signa: string;
  readonly times?: readonly (readonly [string, DiaryMeal?])[];
  readonly tip?: string;
}): CareSectionDraft {
  const times = input.times ?? [];
  return {
    ...newCareSection('drug'),
    title: input.title,
    form: input.form,
    dose: input.dose,
    signa: input.signa,
    times: times.map(([time, meal]) => ({ time, meal })),
    asNeeded: times.length === 0,
    tip: input.tip ?? '',
  };
}

/** The care diary preset: wellbeing morning and evening, vitals. */
function presets(): CareSectionDraft[] {
  const found = emptyCareDraft().sections.filter(
    (section) => section.id === 'am' || section.id === 'pm' || section.id === 'vitals',
  );
  if (found.length !== 3) throw new Error('В шаблоне дневника нет утреннего, вечернего и пульса.');
  return found;
}

function careDraft(sections: readonly CareSectionDraft[]): CareDraft {
  return {
    sections: [...sections, ...presets()],
    contacts: [],
    crisis: '112 — экстренные службы\n103 — скорая помощь',
  };
}

export const DEMO_PATIENTS: readonly DemoPatientSpec[] = [
  {
    label: `${DEMO_LABEL_PREFIX} Лиса`,
    emoji: '🦊',
    days: 28,
    trend: 'improving',
    adherence: 0.93,
    urgentAlert: false,
    vitals: { pulse: 76, systolic: 118, diastolic: 76, spo2: 98 },
    draft: () =>
      careDraft([
        drug({
          title: 'Сертралин',
          form: 'таблетки',
          dose: '50 мг',
          signa: 'По 1 таблетке утром после завтрака',
          times: [['08:00', 'after']],
        }),
        drug({
          title: 'Кветиапин',
          form: 'таблетки',
          dose: '25 мг',
          signa: 'По 1 таблетке за 30 минут до сна',
          times: [['22:00']],
          tip: 'Если утром остаётся сонливость, напишите мне: уменьшим дозу.',
        }),
        drug({
          title: 'Гидроксизин',
          form: 'таблетки',
          dose: '25 мг',
          signa: 'При сильной тревоге, не больше 2 раз в сутки',
        }),
        newCareSection('questionnaire', 'phq-9'),
      ]),
  },
  {
    label: `${DEMO_LABEL_PREFIX} Сова`,
    emoji: '🦉',
    days: 35,
    trend: 'fluctuating',
    adherence: 0.88,
    urgentAlert: false,
    vitals: { pulse: 82, systolic: 126, diastolic: 80, spo2: 97 },
    draft: () =>
      careDraft([
        drug({
          title: 'Вальпроевая кислота',
          form: 'таблетки пролонгированного действия',
          dose: '500 мг',
          signa: 'По 1 таблетке 2 раза в день во время еды',
          times: [
            ['08:00', 'with'],
            ['20:00', 'with'],
          ],
        }),
        drug({
          title: 'Кветиапин',
          form: 'таблетки',
          dose: '25 мг',
          signa: 'По 1 таблетке на ночь',
          times: [['22:30']],
        }),
        newCareSection('choice'),
        newCareSection('text'),
        newCareSection('questionnaire', 'phq-9'),
      ]),
  },
  {
    label: `${DEMO_LABEL_PREFIX} Медведь`,
    emoji: '🐻',
    days: 28,
    trend: 'worsening',
    adherence: 0.9,
    urgentAlert: true,
    vitals: { pulse: 80, systolic: 124, diastolic: 78, spo2: 97 },
    draft: () =>
      careDraft([
        drug({
          title: 'Эсциталопрам',
          form: 'таблетки',
          dose: '10 мг',
          signa: 'По 1 таблетке утром, независимо от еды',
          times: [['09:00']],
        }),
        drug({
          title: 'Гидроксизин',
          form: 'таблетки',
          dose: '25 мг',
          signa: 'При тревоге или бессоннице, не больше 2 таблеток в сутки',
        }),
        newCareSection('questionnaire', 'phq-9'),
        newCareSection('questionnaire', 'gad-7'),
      ]),
  },
  {
    label: `${DEMO_LABEL_PREFIX} Панда`,
    emoji: '🐼',
    days: 21,
    trend: 'stable',
    adherence: 0.97,
    urgentAlert: false,
    vitals: { pulse: 68, systolic: 122, diastolic: 76, spo2: 98 },
    draft: () =>
      careDraft([
        drug({
          title: 'Сертралин',
          form: 'таблетки',
          dose: '100 мг',
          signa: 'По 2 таблетки по 50 мг утром после завтрака',
          times: [['08:00', 'after']],
        }),
        drug({
          title: 'Кветиапин',
          form: 'таблетки',
          dose: '50 мг',
          signa: 'По 1 таблетке на ночь',
          times: [['22:00']],
        }),
        newCareSection('questionnaire', 'phq-9'),
      ]),
  },
];

/** The questions the generator fills, read from a questionnaire's own schema. */
export function questionnaireShape(definition: AssessmentDefinition): QuestionnaireShape {
  const main = definition.scales[0]?.id;
  const items = definition.questions.filter((question) => question.scaleId === main);
  const extras = definition.questions.filter((question) => question.scaleId !== main);
  // An alert rule such as `answer_phq9_09 > 0` names the item whose answer raises it.
  const alerted = (definition.alerts ?? []).flatMap((rule) => {
    const match = /answer_([a-z0-9_]+)\s*>\s*0/u.exec(rule.when);
    return match ? [(match[1] as string).replaceAll('_', '-')] : [];
  });
  const alertItem = items.find((item) => alerted.includes(item.id.replaceAll('_', '-')));
  return {
    items: items.map((item) => item.id),
    extras: extras.map((item) => item.id),
    ...(alertItem ? { alertItem: alertItem.id } : {}),
  };
}

/** Questionnaire slugs of a care draft. */
export function draftQuestionnaires(draft: CareDraft): string[] {
  return [
    ...new Set(
      draft.sections.flatMap((section) => (section.kind === 'questionnaire' ? [section.quiz] : [])),
    ),
  ];
}

export async function loadQuestionnaireShapes(
  slugs: readonly string[],
): Promise<Record<string, QuestionnaireShape>> {
  const shapes: Record<string, QuestionnaireShape> = {};
  for (const slug of slugs) shapes[slug] = questionnaireShape(await loadDiaryQuestionnaire(slug));
  return shapes;
}

/** The demo patient's plan, issued at the start of its history. */
export function demoInvitation(
  spec: DemoPatientSpec,
  patientId: string,
  doctor: string,
  now: Date,
  days = spec.days,
): DiaryInvitation {
  const invitation = careInvitation({ id: patientId, draft: spec.draft(), doctor, note: '' });
  return parseDiaryInvitation({ ...invitation, issuedAt: demoIssuedAt(now, days) }, now.getTime());
}

/** A storage of its own for the throw-away device: nothing reaches the browser's storage. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

export interface SeedDemoOptions {
  /** How many of the demo patients to have (default all four). */
  readonly count?: number;
  /** Days of history for every patient (default: 28, 35, 28 and 21 days). */
  readonly days?: number;
  readonly onProgress?: (text: string) => void;
  /** The moment the history ends; for tests. */
  readonly now?: Date;
}

const BASE_SEED = 20261027;

function pairingOf(link: string): PairingLink {
  const pairing = readPairingFragment(new URL(link).hash);
  if (!pairing) throw new Error('Код подключения не разобран.');
  return pairing;
}

async function seedOne(
  workspace: DoctorDiaries,
  spec: DemoPatientSpec,
  index: number,
  options: { readonly days: number; readonly now: Date; readonly report: (text: string) => void },
): Promise<string> {
  const { days, now, report } = options;
  const shapes = await loadQuestionnaireShapes(draftQuestionnaires(spec.draft()));
  report(`${spec.label}: создаём пациента`);
  const id = await workspace.createPatient({ label: spec.label, emoji: spec.emoji }, (patientId) =>
    demoInvitation(spec, patientId, workspace.session.doctor.name, now, days),
  );
  try {
    report(`${spec.label}: подключаем телефон`);
    const storage = memoryStorage();
    const store = createDiaryStore(storage, () => now.getTime());
    const connection = await PatientConnection.pair(
      storage,
      store,
      pairingOf(await workspace.pairingLink(id)),
    );
    const results = store.read(id);
    if (!results) throw new Error('Дневник на телефоне не открылся.');
    const diary = generateDemoDiary({
      invitation: results.invitation,
      behavior: spec,
      questionnaires: shapes,
      now,
      days,
      seed: BASE_SEED + index * 7919,
    });
    report(`${spec.label}: записываем ${days} дн. (${diary.entries.length} записей)`);
    store.save({ v: DIARY_FORMAT_VERSION, invitation: results.invitation, entries: diary.entries });
    store.setMeta(id, { consentAt: diary.consentAt });
    const status = await connection.sync();
    if (status.phase !== 'idle' || status.pending > 0) {
      throw new Error(status.message ?? 'Записи не отправились на сервер.');
    }
    if (diary.alertEntryId) {
      const alerted = await connection.raiseAlert();
      if (alerted.phase !== 'idle') throw new Error(alerted.message ?? 'Сигнал не отправился.');
    }
    await workspace.refreshPatient(id);
  } catch (cause) {
    // A half-made demo patient would block the next run (and look broken): take it away.
    await workspace.removePatient(id).catch((removal: unknown) => {
      console.warn('Демо-пациент не удалён после ошибки', removal);
    });
    throw cause;
  }
  return id;
}

/**
 * Makes the demo patients of the doctor's account and fills their diaries. Patients whose label
 * already exists are kept and not touched; the missing ones are created, so a second call adds
 * nothing and a call after a failure completes the set. Returns the ids of the first `count`
 * demo patients, in order. Needs a signed-in `workspace` and the diary service reachable from
 * this origin (the patient device talks to `/api` like a real phone).
 */
export async function seedDemoPatients(
  workspace: DoctorDiaries,
  options: SeedDemoOptions = {},
): Promise<readonly string[]> {
  const specs = DEMO_PATIENTS.slice(0, Math.max(0, options.count ?? DEMO_PATIENTS.length));
  const report = options.onProgress ?? (() => undefined);
  const now = options.now ?? new Date();
  if (!workspace.isLoaded()) await workspace.refresh();
  const ids: string[] = [];
  for (const [index, spec] of specs.entries()) {
    const existing = workspace
      .patients()
      .find((patient) => patient.replica.profile?.label === spec.label);
    if (existing) {
      ids.push(existing.summary.id);
      continue;
    }
    const days = Math.min(90, Math.max(7, Math.round(options.days ?? spec.days)));
    ids.push(await seedOne(workspace, spec, index, { days, now, report }));
  }
  report('Готово');
  return ids;
}
