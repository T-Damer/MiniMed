import { createMemo, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { describeRanges } from '@/components/date-ranges';
import { PillMark } from '@/components/PillMark';
import { DiaryHeatmap } from '@/diary/DiaryHeatmap';
import { CareRow } from '@/diary/DiaryToday';
import {
  CHECK_KINDS,
  drugRows,
  drugTitle,
  emptyHeat,
  KIND_ICON,
  labDetail,
  sectionDetail,
  sectionTitle,
  taskDetail,
  visitTitle,
} from '@/features/diary/care-screen-rows';
import { DAY_PERIOD_LABEL, dayKey } from '@/features/diary/diary-care';
import type { CareDraft, CareSectionDraft } from '@/features/diary/diary-care-draft';
import { DIARY_MEAL_LABEL } from '@/features/diary/diary-model';
import type { PatientStep } from '@/features/diary/FormStep';

import '@/features/diary/patient-view.css';

/**
 * The patient's phone screen as it will look, built from the doctor's draft and read-only
 * (owner 2026-11-10). It is drawn blue (`.patient-view` scopes its own tokens), so the doctor always
 * knows which side is the patient's. Nothing here changes the draft or ticks anything: a tap on a
 * row only takes the doctor to the step of the form where that row is edited.
 */
export function PatientView(props: {
  readonly draft: CareDraft;
  readonly doctor: string;
  readonly note: string;
  readonly onStep: (step: PatientStep) => void;
}): JSX.Element {
  const today = dayKey(new Date());
  const sections = (): readonly CareSectionDraft[] => props.draft.sections;
  const sectionOf = (key: string): CareSectionDraft | undefined =>
    sections().find((section) => section.key === key);
  const doses = createMemo(() => drugRows(sections()));
  const checks = createMemo(() => sections().filter((s) => CHECK_KINDS.includes(s.kind)));
  const quizzes = createMemo(() => sections().filter((s) => s.kind === 'questionnaire'));
  const tasks = () => props.draft.assignments ?? [];
  const visits = () => props.draft.appointments ?? [];
  const labs = () => props.draft.labs ?? [];
  const contactCount = (): number =>
    props.draft.contacts.filter((contact) => contact.value.trim()).length;
  const hasDrugs = (): boolean => doses().timed.length > 0 || doses().asNeeded.length > 0;
  const hasAnything = (): boolean =>
    hasDrugs() ||
    checks().length > 0 ||
    quizzes().length > 0 ||
    tasks().length > 0 ||
    visits().length > 0 ||
    labs().length > 0;
  const heat = emptyHeat(today);
  const tip = (section: CareSectionDraft | undefined): boolean => Boolean(section?.tip.trim());

  return (
    <section class="patient-view" aria-labelledby="patient-view-title" data-testid="patient-view">
      <h2 class="patient-view__title" id="patient-view-title">
        <AppGlyph name="phone" class="patient-view__title-glyph" />
        Так видит пациент
      </h2>
      <div class="patient-view__screen">
        <header class="patient-view__header">
          <p class="diary-today__title patient-view__name">Дневник лечения</p>
          <div class="patient-view__tools" aria-hidden="true">
            <Show when={contactCount()}>
              <span class="diary-today__icon patient-view__tool">
                <AppGlyph name="phone" class="diary-today__icon-glyph" />
              </span>
            </Show>
            <span class="diary-today__icon diary-today__icon--help patient-view__tool">
              <AppGlyph name="lifebuoy" class="diary-today__icon-glyph" />
            </span>
          </div>
          <Show when={props.doctor.trim()}>
            <p class="patient-view__doctor">{props.doctor.trim()}</p>
          </Show>
        </header>

        {/* A calendar to look at: its days are not buttons here. */}
        <div class="patient-view__heat" inert>
          <DiaryHeatmap days={heat} selected={today} today={today} onSelect={() => undefined} />
        </div>

        <Show when={props.note.trim()}>
          <p class="diary-today__note patient-view__note">{props.note.trim()}</p>
        </Show>

        <Show when={hasDrugs()}>
          <section class="care-section">
            <h3 class="care-section__title">Лекарства</h3>
            <For each={doses().timed}>
              {(group) => (
                <>
                  <p class="care-section__period">{DAY_PERIOD_LABEL[group.period]}</p>
                  <ul class="care-section__list">
                    <For each={group.rows}>
                      {(row) => (
                        <CareRow
                          icon="pill"
                          mark={
                            <PillMark
                              name={sectionOf(row.key)?.title ?? ''}
                              form={sectionOf(row.key)?.form}
                            />
                          }
                          time={row.time.time}
                          title={drugTitle(sectionOf(row.key))}
                          detail={
                            [
                              row.time.meal ? DIARY_MEAL_LABEL[row.time.meal] : '',
                              sectionOf(row.key)?.course.length
                                ? describeRanges(sectionOf(row.key)?.course ?? [])
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ') || undefined
                          }
                          state="open"
                          checkLabel={`${sectionTitle(sectionOf(row.key))} в ${row.time.time}: показать в форме`}
                          tip={tip(sectionOf(row.key))}
                          onCheck={() => props.onStep('now')}
                          onOpen={() => props.onStep('now')}
                        />
                      )}
                    </For>
                  </ul>
                </>
              )}
            </For>
            <Show when={doses().asNeeded.length}>
              <p class="care-section__period">При необходимости</p>
              <ul class="care-section__list">
                <For each={doses().asNeeded}>
                  {(key) => (
                    <CareRow
                      icon="plus"
                      title={drugTitle(sectionOf(key))}
                      detail="Отметьте, когда примете"
                      state="idle"
                      checkLabel={`${sectionTitle(sectionOf(key))}: показать в форме`}
                      tip={tip(sectionOf(key))}
                      onCheck={() => props.onStep('now')}
                      onOpen={() => props.onStep('now')}
                    />
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </Show>

        <Show when={checks().length}>
          <section class="care-section">
            <h3 class="care-section__title">Самочувствие и показатели</h3>
            <ul class="care-section__list">
              <For each={checks()}>
                {(section) => (
                  <CareRow
                    icon={KIND_ICON[section.kind]}
                    time={section.times.find((time) => time.time)?.time}
                    title={sectionTitle(section)}
                    detail={sectionDetail(section) || undefined}
                    state="open"
                    checkLabel={`${sectionTitle(section)}: показать в форме`}
                    tip={tip(section)}
                    onCheck={() => props.onStep('marks')}
                    onOpen={() => props.onStep('marks')}
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={quizzes().length}>
          <section class="care-section">
            <h3 class="care-section__title">Опросники</h3>
            <ul class="care-section__list">
              <For each={quizzes()}>
                {(section) => (
                  <CareRow
                    icon="list-checks"
                    title={sectionTitle(section)}
                    detail={sectionDetail(section)}
                    state="idle"
                    checkLabel={`${sectionTitle(section)}: показать в форме`}
                    tip={tip(section)}
                    onCheck={() => props.onStep('marks')}
                    onOpen={() => props.onStep('marks')}
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={tasks().length}>
          <section class="care-section">
            <h3 class="care-section__title">Задания</h3>
            <ul class="care-section__list">
              <For each={tasks()}>
                {(task) => (
                  <CareRow
                    icon="note-pencil"
                    title={task.worksheet.title}
                    detail={taskDetail(task)}
                    state="open"
                    checkLabel={`${task.worksheet.title}: показать в форме`}
                    tip={false}
                    onCheck={() => props.onStep('visits')}
                    onOpen={() => props.onStep('visits')}
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={visits().length}>
          <section class="care-section">
            <h3 class="care-section__title">Приёмы у врача</h3>
            <ul class="care-section__list">
              <For each={visits()}>
                {(visit) => (
                  <CareRow
                    icon="calendar-check"
                    title={visitTitle(visit, today)}
                    detail={visit.place.trim() || undefined}
                    state="idle"
                    checkLabel={`${visitTitle(visit, today)}: показать в форме`}
                    tip={false}
                    onCheck={() => props.onStep('visits')}
                    onOpen={() => props.onStep('visits')}
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={labs().length}>
          <section class="care-section">
            <h3 class="care-section__title">Анализы</h3>
            <ul class="care-section__list">
              <For each={labs()}>
                {(lab) => (
                  <CareRow
                    icon="flask"
                    title={lab.name.trim() || 'Анализ'}
                    detail={labDetail(lab, today)}
                    state="open"
                    checkLabel={`${lab.name.trim() || 'Анализ'}: показать в форме`}
                    tip={false}
                    onCheck={() => props.onStep('visits')}
                    onOpen={() => props.onStep('visits')}
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>

        <section class="care-section">
          <h3 class="care-section__title">Своими словами</h3>
          <ul class="care-section__list">
            <CareRow
              icon="note-pencil"
              title="Рассказать врачу"
              detail="что беспокоит — текстом или голосом; есть у каждого пациента"
              state="open"
              checkLabel="Рассказать врачу своими словами"
              tip={false}
              onCheck={() => props.onStep('marks')}
              onOpen={() => props.onStep('marks')}
            />
          </ul>
        </section>

        <Show when={!hasAnything()}>
          <p class="patient-view__empty">Что вы добавите в форму, появится здесь.</p>
        </Show>
      </div>
    </section>
  );
}
