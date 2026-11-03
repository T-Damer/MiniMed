import { createMemo, createResource, For, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { dayKey, dayPlan, type TaskState } from '@/features/diary/diary-care';
import type { DiaryResults } from '@/features/diary/diary-model';
import { type PlanEdit, planOn } from '@/features/diary/plan-history';

interface DayTask {
  readonly key: string;
  readonly text: string;
  readonly time: string | undefined;
  readonly state: TaskState;
}

const STATE: Readonly<
  Record<TaskState, { readonly label: string; readonly glyph: AppGlyphName; readonly tone: string }>
> = {
  done: { label: 'выполнено', glyph: 'check', tone: 'good' },
  skipped: { label: 'пропущено пациентом', glyph: 'close', tone: 'warn' },
  missed: { label: 'не отмечено', glyph: 'close', tone: 'danger' },
  late: { label: 'не отмечено вовремя', glyph: 'clock', tone: 'warn' },
  open: { label: 'ещё впереди', glyph: 'clock', tone: 'quiet' },
};

function time(at: string): string {
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * One calendar day for the doctor (DIARY20, owner 2026-11-03: «what the patient did, what completed,
 * what ignored»): the plan's tasks of that day as the plan then stood, done first; the plan changes
 * made that day and by whom; then the day's records with their corrections. The patient's own
 * screen for the day — to fill in or change a mark — is the button at the bottom.
 */
export function PatientDayDetails(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  readonly results: DiaryResults;
  readonly day: string;
  readonly edits: readonly PlanEdit[];
  /** The day's records, newest first, with their correction buttons. */
  readonly records: JSX.Element;
  readonly onFill: () => void;
}): JSX.Element {
  const canEdit = (): boolean => props.patient.summary.role !== 'reader';
  const tasks = createMemo((): DayTask[] => {
    const invitation = planOn(
      props.patient.replica.planHistory,
      props.day,
      props.results.invitation,
    );
    const plan = dayPlan(invitation, props.results.entries, props.day);
    const all: DayTask[] = [
      ...plan.doses.map((task) => ({
        key: task.key,
        text: [task.item.name, task.time.dose ?? task.item.dose].filter(Boolean).join(' '),
        time: task.time.time,
        state: task.state,
      })),
      ...plan.checks.map((task) => ({
        key: task.key,
        text: task.checkpoint.label,
        time: task.time,
        state: task.state,
      })),
      ...plan.questionnaires
        .filter((task) => task.due)
        .map(
          (task): DayTask => ({
            key: `q-${task.checkpoint.id}`,
            text: task.checkpoint.label,
            time: undefined,
            state: task.entry ? 'done' : props.day < dayKey(new Date()) ? 'missed' : 'open',
          }),
        ),
    ];
    const order: readonly TaskState[] = ['done', 'skipped', 'missed', 'late', 'open'];
    return all.toSorted(
      (left, right) =>
        order.indexOf(left.state) - order.indexOf(right.state) ||
        (left.time ?? '').localeCompare(right.time ?? ''),
    );
  });
  const done = (): number => tasks().filter((task) => task.state === 'done').length;
  // Who changed the plan: the curators' names, fetched only when the day has a change.
  const [members] = createResource(
    () => (props.edits.length ? props.patient.summary.id : undefined),
    (id) => props.workspace.detail(id).then((detail) => detail.members),
  );
  const authorName = (author: string): string => {
    const id = author.slice(2);
    if (id === props.workspace.doctorId) return 'вы';
    const member = members()?.find((candidate) => candidate.doctor.id === id);
    return member?.doctor.name || member?.doctor.email || 'коллега';
  };

  return (
    <div class="diary-day-details">
      <Show when={props.edits.length}>
        <section class="diary-day-details__changes" aria-label="Изменения плана">
          <For each={props.edits}>
            {(edit) => (
              <div class="diary-day-details__change">
                <p class="diary-day-details__change-head">
                  <AppGlyph name="edit" class="diary-day-details__change-glyph" />
                  {edit.first ? 'Дневник начат' : 'План изменён'} · {time(edit.at)} ·{' '}
                  {authorName(edit.author)}
                </p>
                <Show when={!edit.first}>
                  <ul class="diary-day-details__change-lines">
                    <For each={edit.lines}>{(line) => <li>{line}</li>}</For>
                  </ul>
                </Show>
              </div>
            )}
          </For>
        </section>
      </Show>

      <Show when={tasks().length}>
        <section class="diary-day-details__plan" aria-label="План дня">
          <p class="diary-day-details__summary">
            Выполнено {done()} из {tasks().length}
          </p>
          <ul class="diary-day-details__tasks">
            <For each={tasks()}>
              {(task) => (
                <li class={`diary-day-task diary-day-task--${STATE[task.state].tone}`}>
                  <span class="diary-day-task__mark" aria-hidden="true">
                    <AppGlyph name={STATE[task.state].glyph} class="diary-day-task__glyph" />
                  </span>
                  <span class="diary-day-task__text">
                    {task.text}
                    <span class="diary-day-task__state">
                      {task.time ? `${task.time} · ` : ''}
                      {STATE[task.state].label}
                    </span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      {props.records}

      <Button
        class="diary-day-details__fill"
        variant={tasks().some((task) => task.state !== 'done') ? 'primary' : 'secondary'}
        icon={<AppGlyph name="edit" class="diary-dash__glyph" />}
        onClick={() => props.onFill()}
      >
        {canEdit() ? 'Заполнить или изменить за пациента' : 'Открыть день пациента'}
      </Button>
    </div>
  );
}
