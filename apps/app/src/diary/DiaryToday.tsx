import { createMemo, createSignal, For, type JSX, Match, onMount, Show, Switch } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { CareIntro } from '@/diary/CareIntro';
import { ContactsSheet, CrisisSheet } from '@/diary/care-contacts';
import { type CareSave, DoseSheet, NoteSheet, ScoreSheet, VitalsSheet } from '@/diary/care-sheets';
import { DiaryHeatmap, heatmapRange } from '@/diary/DiaryHeatmap';
import { formatTime, pluralize } from '@/diary/diary-format';
import { QuestionnaireSheet } from '@/diary/QuestionnaireSheet';
import {
  addDays,
  atTime,
  CARE_DOSE_FIELD,
  type CheckTask,
  DAY_PERIOD_LABEL,
  type DayPeriod,
  type DoseTask,
  dayKey,
  dayPeriod,
  dayPlan,
  dayStart,
  heatmapDays,
  type QuestionnaireTask,
  type TaskState,
} from '@/features/diary/diary-care';
import type { DiaryShareStatus } from '@/features/diary/diary-merge';
import {
  createDiaryId,
  DIARY_MEAL_LABEL,
  type DiaryCheckpoint,
  type DiaryDoseTime,
  type DiaryEntry,
  type DiaryPlanItem,
  type DiaryPlanValue,
  type DiaryResults,
} from '@/features/diary/diary-model';
import { diaryQuestionnaire, loadDiaryQuestionnaire } from '@/features/diary/diary-questionnaires';

type Sheet =
  | {
      readonly kind: 'dose';
      readonly item: DiaryPlanItem;
      readonly time: DiaryDoseTime | undefined;
      readonly entry: DiaryEntry | undefined;
    }
  | { readonly kind: 'check'; readonly task: CheckTask }
  | { readonly kind: 'quiz'; readonly task: QuestionnaireTask }
  | { readonly kind: 'note'; readonly entry: DiaryEntry | undefined }
  | { readonly kind: 'contacts' }
  | { readonly kind: 'crisis'; readonly raised: boolean };

/** Runs after the browser has stepped back from a closed sheet, so a new sheet is not popped. */
function afterHistoryStep(run: () => void): void {
  let done = false;
  const once = (): void => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', once);
    run();
  };
  window.addEventListener('popstate', once);
  window.setTimeout(once, 400);
}

function dayTitle(day: string, today: string): string {
  const date = dayStart(day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  if (day === today) return `Сегодня, ${date}`;
  if (day === addDays(today, -1)) return `Вчера, ${date}`;
  const weekday = dayStart(day).toLocaleDateString('ru-RU', { weekday: 'long' });
  return `${weekday[0]?.toUpperCase() ?? ''}${weekday.slice(1)}, ${date}`;
}

const STATE_WORD: Readonly<Partial<Record<TaskState, string>>> = {
  late: 'Пора',
  missed: 'Не отмечено',
};

function doseStatus(task: DoseTask): string {
  const value = task.entry?.values[CARE_DOSE_FIELD] as DiaryPlanValue | undefined;
  if (task.entry && value?.done === false) return 'Пропущено';
  if (task.entry) {
    const after = task.entry.values['after'];
    const effects = Array.isArray(after) && after.length ? ` · ${after.join(', ')}` : '';
    return `Принято в ${formatTime(task.entry.at)}${effects}`;
  }
  return STATE_WORD[task.state] ?? '';
}

function checkStatus(task: CheckTask): string {
  const entry = task.entry;
  if (!entry) return STATE_WORD[task.state] ?? '';
  const values = entry.values;
  if (task.checkpoint.kind === 'score') {
    const field = task.checkpoint.fields?.[0];
    const value = field ? values[field] : undefined;
    return typeof value === 'number' ? `${value} из 10 · ${formatTime(entry.at)}` : '';
  }
  const parts: string[] = [];
  if (typeof values['systolic'] === 'number' && typeof values['diastolic'] === 'number') {
    parts.push(`${values['systolic']}/${values['diastolic']}`);
  }
  if (typeof values['pulse'] === 'number') parts.push(`пульс ${values['pulse']}`);
  if (typeof values['spo2'] === 'number') parts.push(`SpO₂ ${values['spo2']} %`);
  return parts.join(', ') || 'Заполнено';
}

function quizStatus(task: QuestionnaireTask, today: string): string {
  if (task.entry) return `Заполнено в ${formatTime(task.entry.at)}`;
  if (task.due) return 'Пора заполнить';
  if (!task.nextDay) return '';
  const next = dayStart(task.nextDay).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
  return task.nextDay <= today ? 'Пора заполнить' : `Следующий раз ${next}`;
}

/** One line of the day: a round check on the left, the text opening its sheet. */
function CareRow(props: {
  readonly icon: AppGlyphName;
  readonly time?: string | undefined;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly state: TaskState | 'idle';
  readonly checkLabel: string;
  readonly tip: boolean;
  readonly onCheck: () => void;
  readonly onOpen: () => void;
}): JSX.Element {
  const done = (): boolean => props.state === 'done';
  return (
    <li
      class="care-row"
      classList={{
        'care-row--done': done(),
        'care-row--skipped': props.state === 'skipped',
        'care-row--late': props.state === 'late',
        'care-row--missed': props.state === 'missed',
      }}
    >
      <button
        type="button"
        class="care-row__check"
        classList={{ 'care-row__check--done': done() }}
        aria-label={props.checkLabel}
        aria-pressed={done()}
        onClick={() => props.onCheck()}
      >
        <AppGlyph
          name={done() ? 'check' : props.state === 'skipped' ? 'minus' : props.icon}
          class="care-row__check-icon"
        />
      </button>
      <button type="button" class="care-row__main" onClick={() => props.onOpen()}>
        <span class="care-row__line">
          <Show when={props.time}>
            <span class="care-row__time">{props.time}</span>
          </Show>
          <span class="care-row__title">{props.title}</span>
          <Show when={props.tip}>
            <span class="care-row__tip">
              <span aria-hidden="true">?</span>
              <span class="care-row__tip-text">Есть подсказка врача</span>
            </span>
          </Show>
        </span>
        <Show when={props.detail}>
          <span
            class="care-row__detail"
            classList={{ 'care-row__detail--late': props.state === 'late' }}
          >
            {props.detail}
          </span>
        </Show>
      </button>
    </li>
  );
}

/**
 * The page of a care diary: the year calendar, the chosen day's intakes, checkpoints and
 * questionnaires as one checklist, the patient's own descriptions, and help one tap away.
 */
export function DiaryToday(props: {
  readonly results: DiaryResults;
  readonly status: DiaryShareStatus;
  readonly consentAt: string | undefined;
  readonly tipsRead: readonly string[];
  readonly hasOtherDiaries: boolean;
  readonly onSave: CareSave;
  readonly onRemove: (entry: DiaryEntry) => void;
  readonly onConsent: () => void;
  readonly onTipRead: (id: string) => void;
  readonly onRecords: () => void;
  readonly onSend: () => void;
  readonly onMore: () => void;
  readonly onList: () => void;
}): JSX.Element {
  const invitation = () => props.results.invitation;
  const [now, setNow] = createSignal(new Date());
  const today = () => dayKey(now());
  const [day, setDay] = createSignal(dayKey(new Date()));
  const [sheet, setSheet] = createSignal<Sheet | undefined>(undefined);
  const [flash, setFlash] = createSignal('');

  // Questionnaires load on first use; fetch them while online so the diary's worker keeps them
  // and a questionnaire opens without a network later.
  onMount(() => {
    for (const checkpoint of invitation().checkpoints ?? []) {
      if (checkpoint.questionnaire) {
        loadDiaryQuestionnaire(checkpoint.questionnaire).catch((cause: unknown) => {
          // The sheet shows the failure when the patient opens it; this only explains the cause.
          console.warn('Опросник не загружен заранее:', cause);
        });
      }
    }
  });

  const plan = createMemo(() => dayPlan(invitation(), props.results.entries, day(), now()));
  const heat = createMemo(() => {
    const started = props.results.entries.reduce(
      (earliest, entry) => (dayKey(entry.at) < earliest ? dayKey(entry.at) : earliest),
      dayKey(invitation().issuedAt),
    );
    const range = heatmapRange(started, today());
    return heatmapDays(invitation(), props.results.entries, range.from, range.to, now());
  });

  const tipFor = (...targets: readonly (string | undefined)[]) =>
    invitation().tips?.find((tip) => targets.includes(tip.target));
  const unreadTip = (...targets: readonly (string | undefined)[]): boolean => {
    const tip = tipFor(...targets);
    return Boolean(tip && !props.tipsRead.includes(tip.id));
  };
  const readTip = (...targets: readonly (string | undefined)[]): string | undefined => {
    const tip = tipFor(...targets);
    if (tip && !props.tipsRead.includes(tip.id)) props.onTipRead(tip.id);
    return tip?.text;
  };

  const close = (): void => setSheet(undefined);
  const save: CareSave = (value) => {
    const problem = props.onSave(value);
    if (!problem) {
      setNow(new Date());
      setFlash('Сохранено');
      window.setTimeout(() => setFlash(''), 2200);
      close();
    }
    return problem;
  };
  const remove = (entry: DiaryEntry): void => {
    props.onRemove(entry);
    setFlash('Отметка удалена');
    window.setTimeout(() => setFlash(''), 2200);
    close();
  };

  /** The round button of an intake: one tap marks it taken now; a marked one opens to edit. */
  const quickDose = (task: DoseTask): void => {
    if (task.entry) {
      setSheet({ kind: 'dose', item: task.item, time: task.time, entry: task.entry });
      return;
    }
    save({
      id: createDiaryId(),
      at: day() === today() ? new Date().toISOString() : atTime(day(), task.time.time),
      values: { [CARE_DOSE_FIELD]: { item: task.item.id, done: true, slot: task.time.time } },
    });
  };

  const openCheck = (task: CheckTask): void => {
    setSheet({ kind: 'check', task });
  };

  const periods = createMemo(() => {
    const groups: { period: DayPeriod; tasks: DoseTask[] }[] = [];
    for (const task of plan().doses) {
      const period = dayPeriod(task.time.time);
      const group = groups.find((candidate) => candidate.period === period);
      if (group) group.tasks.push(task);
      else groups.push({ period, tasks: [task] });
    }
    return groups;
  });

  const progress = (): string =>
    plan().total
      ? `${plan().done} из ${plan().total} ${pluralize(plan().total, 'отметки', 'отметок', 'отметок')}`
      : '';

  const scoreField = (checkpoint: DiaryCheckpoint) =>
    invitation().fields.find((field) => field.id === checkpoint.fields?.[0]);

  return (
    <Show
      when={!invitation().consent || props.consentAt}
      fallback={<CareIntro invitation={invitation()} onDone={props.onConsent} />}
    >
      <main class="diary-page diary-page--care diary-today">
        <header class="diary-today__header">
          <Show when={props.hasOtherDiaries}>
            <button
              type="button"
              class="diary-today__icon"
              aria-label="Мои дневники"
              onClick={() => props.onList()}
            >
              <AppGlyph name="arrow-left" class="diary-today__icon-glyph" />
            </button>
          </Show>
          <div class="diary-today__titles">
            <h1 class="diary-today__title">{invitation().title}</h1>
            <Show when={invitation().doctor}>
              <p class="diary-today__doctor">{invitation().doctor}</p>
            </Show>
          </div>
          <Show when={invitation().contacts?.length}>
            <button
              type="button"
              class="diary-today__icon"
              aria-label="Связаться с врачом"
              onClick={() => setSheet({ kind: 'contacts' })}
            >
              <AppGlyph name="phone" class="diary-today__icon-glyph" />
            </button>
          </Show>
          <button
            type="button"
            class="diary-today__icon diary-today__icon--help"
            aria-label="Помощь, если очень плохо"
            onClick={() => setSheet({ kind: 'crisis', raised: false })}
          >
            <AppGlyph name="lifebuoy" class="diary-today__icon-glyph" />
          </button>
        </header>

        <DiaryHeatmap days={heat()} selected={day()} today={today()} onSelect={setDay} />

        <nav class="diary-today__day" aria-label="День">
          <button
            type="button"
            class="diary-today__step"
            aria-label="Предыдущий день"
            onClick={() => setDay(addDays(day(), -1))}
          >
            <AppGlyph name="caret-left" class="diary-today__step-icon" />
          </button>
          <div class="diary-today__day-text">
            <h2 class="diary-today__day-title">{dayTitle(day(), today())}</h2>
            <Show when={progress()}>
              <p class="diary-today__progress">{progress()}</p>
            </Show>
          </div>
          <button
            type="button"
            class="diary-today__step"
            aria-label="Следующий день"
            disabled={day() >= today()}
            onClick={() => setDay(addDays(day(), 1))}
          >
            <AppGlyph name="caret-right" class="diary-today__step-icon" />
          </button>
        </nav>

        <Show when={invitation().note}>
          <p class="diary-today__note">{invitation().note}</p>
        </Show>

        <Show when={plan().doses.length || plan().asNeeded.length}>
          <section class="care-section" aria-labelledby="care-doses">
            <h3 class="care-section__title" id="care-doses">
              {invitation().planTitle ?? 'Лекарства'}
            </h3>
            <For each={periods()}>
              {(group) => (
                <>
                  <p class="care-section__period">{DAY_PERIOD_LABEL[group.period]}</p>
                  <ul class="care-section__list">
                    <For each={group.tasks}>
                      {(task) => (
                        <CareRow
                          icon="pill"
                          time={task.time.time}
                          title={[task.item.name, task.time.dose ?? task.item.dose]
                            .filter(Boolean)
                            .join(' ')}
                          detail={
                            doseStatus(task) ||
                            (task.time.meal ? DIARY_MEAL_LABEL[task.time.meal] : undefined)
                          }
                          state={task.state}
                          checkLabel={`${task.item.name} в ${task.time.time}: отметить приём`}
                          tip={unreadTip(task.item.id)}
                          onCheck={() => quickDose(task)}
                          onOpen={() =>
                            setSheet({
                              kind: 'dose',
                              item: task.item,
                              time: task.time,
                              entry: task.entry,
                            })
                          }
                        />
                      )}
                    </For>
                  </ul>
                </>
              )}
            </For>
            <Show when={plan().asNeeded.length}>
              <p class="care-section__period">При необходимости</p>
              <ul class="care-section__list">
                <For each={plan().asNeeded}>
                  {(group) => (
                    <CareRow
                      icon="plus"
                      title={[group.item.name, group.item.dose].filter(Boolean).join(' ')}
                      detail={
                        group.entries.length
                          ? `Сегодня: ${group.entries.map((entry) => formatTime(entry.at)).join(', ')}`
                          : 'Отметьте, когда примете'
                      }
                      state="idle"
                      checkLabel={`${group.item.name}: отметить приём`}
                      tip={unreadTip(group.item.id)}
                      onCheck={() =>
                        setSheet({
                          kind: 'dose',
                          item: group.item,
                          time: undefined,
                          entry: undefined,
                        })
                      }
                      onOpen={() =>
                        setSheet({
                          kind: 'dose',
                          item: group.item,
                          time: undefined,
                          entry: undefined,
                        })
                      }
                    />
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </Show>

        <Show when={plan().checks.length}>
          <section class="care-section" aria-labelledby="care-checks">
            <h3 class="care-section__title" id="care-checks">
              Самочувствие и показатели
            </h3>
            <ul class="care-section__list">
              <For each={plan().checks}>
                {(task) => (
                  <CareRow
                    icon={task.checkpoint.kind === 'score' ? 'smiley' : 'heartbeat'}
                    time={task.time}
                    title={task.checkpoint.label}
                    detail={checkStatus(task)}
                    state={task.state}
                    checkLabel={`${task.checkpoint.label}: заполнить`}
                    tip={unreadTip(task.checkpoint.id, ...(task.checkpoint.fields ?? []))}
                    onCheck={() => openCheck(task)}
                    onOpen={() => openCheck(task)}
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={plan().questionnaires.length}>
          <section class="care-section" aria-labelledby="care-quiz">
            <h3 class="care-section__title" id="care-quiz">
              Опросники
            </h3>
            <ul class="care-section__list">
              <For each={plan().questionnaires}>
                {(task) => (
                  <CareRow
                    icon="list-checks"
                    title={task.checkpoint.label}
                    detail={[
                      diaryQuestionnaire(task.checkpoint.questionnaire ?? '')?.about,
                      quizStatus(task, today()),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    state={task.entry ? 'done' : task.due ? 'late' : 'idle'}
                    checkLabel={`${task.checkpoint.label}: заполнить`}
                    tip={unreadTip(task.checkpoint.id)}
                    onCheck={() => setSheet({ kind: 'quiz', task })}
                    onOpen={() => setSheet({ kind: 'quiz', task })}
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>

        <section class="care-section" aria-labelledby="care-notes">
          <h3 class="care-section__title" id="care-notes">
            Описание состояния
          </h3>
          <Show when={plan().notes.length}>
            <ul class="care-notes">
              <For each={plan().notes}>
                {(entry) => (
                  <li class="care-notes__item">
                    <button
                      type="button"
                      class="care-note"
                      onClick={() => setSheet({ kind: 'note', entry })}
                    >
                      <span class="care-note__time">{formatTime(entry.at)}</span>
                      <span class="care-note__text">
                        {typeof entry.values['state'] === 'string'
                          ? entry.values['state']
                          : entry.note}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <button
            type="button"
            class="care-add"
            onClick={() => setSheet({ kind: 'note', entry: undefined })}
          >
            <AppGlyph name="note-pencil" class="care-add__icon" />
            <span class="care-add__text">Добавить описание состояния</span>
          </button>
        </section>

        <p class="diary-today__flash" role="status" aria-live="polite">
          {flash()}
        </p>

        <nav class="diary-today__bar" aria-label="Дневник">
          <button type="button" class="diary-today__bar-button" onClick={() => props.onRecords()}>
            <AppGlyph name="list" class="diary-today__bar-icon" />
            <span class="diary-today__bar-text">Записи</span>
          </button>
          <button
            type="button"
            class="diary-today__bar-button"
            classList={{ 'diary-today__bar-button--pending': props.status.unsent > 0 }}
            onClick={() => props.onSend()}
          >
            <AppGlyph name="share" class="diary-today__bar-icon" />
            <span class="diary-today__bar-text">
              {props.status.unsent > 0 ? `Отправить (${props.status.unsent})` : 'Отправить'}
            </span>
          </button>
          <button type="button" class="diary-today__bar-button" onClick={() => props.onMore()}>
            <AppGlyph name="dots-three" class="diary-today__bar-icon" />
            <span class="diary-today__bar-text">Ещё</span>
          </button>
        </nav>
      </main>

      <Switch>
        <Match when={sheet()?.kind === 'dose' && (sheet() as Extract<Sheet, { kind: 'dose' }>)}>
          {(current) => (
            <DoseSheet
              invitation={invitation()}
              day={day()}
              item={current().item}
              time={current().time}
              entry={current().entry}
              tip={readTip(current().item.id)}
              onSave={save}
              onRemove={remove}
              onClose={close}
            />
          )}
        </Match>
        <Match when={sheet()?.kind === 'check' && (sheet() as Extract<Sheet, { kind: 'check' }>)}>
          {(current) => (
            <Show
              when={
                current().task.checkpoint.kind === 'score' && scoreField(current().task.checkpoint)
              }
              fallback={
                <VitalsSheet
                  invitation={invitation()}
                  day={day()}
                  checkpoint={current().task.checkpoint}
                  time={current().task.time}
                  entry={current().task.entry}
                  tip={readTip(
                    current().task.checkpoint.id,
                    ...(current().task.checkpoint.fields ?? []),
                  )}
                  onSave={save}
                  onRemove={remove}
                  onClose={close}
                />
              }
            >
              {(field) => (
                <ScoreSheet
                  day={day()}
                  checkpoint={current().task.checkpoint}
                  field={field()}
                  time={current().task.time}
                  entry={current().task.entry}
                  tip={readTip(current().task.checkpoint.id, field().id)}
                  onSave={save}
                  onRemove={remove}
                  onClose={close}
                />
              )}
            </Show>
          )}
        </Match>
        <Match when={sheet()?.kind === 'quiz' && (sheet() as Extract<Sheet, { kind: 'quiz' }>)}>
          {(current) => (
            <QuestionnaireSheet
              day={day()}
              checkpoint={current().task.checkpoint}
              entry={current().task.entry}
              onSave={save}
              onAlert={() => afterHistoryStep(() => setSheet({ kind: 'crisis', raised: true }))}
              onClose={close}
            />
          )}
        </Match>
        <Match when={sheet()?.kind === 'note' && (sheet() as Extract<Sheet, { kind: 'note' }>)}>
          {(current) => (
            <NoteSheet
              day={day()}
              entry={current().entry}
              onSave={save}
              onRemove={remove}
              onClose={close}
            />
          )}
        </Match>
        <Match when={sheet()?.kind === 'contacts'}>
          <ContactsSheet invitation={invitation()} onClose={close} />
        </Match>
        <Match when={sheet()?.kind === 'crisis' && (sheet() as Extract<Sheet, { kind: 'crisis' }>)}>
          {(current) => (
            <CrisisSheet invitation={invitation()} raised={current().raised} onClose={close} />
          )}
        </Match>
      </Switch>
    </Show>
  );
}
