import { createResource, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { DateField } from '@/components/DateField';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { CareSave } from '@/diary/care-sheets';
import { QuestionnaireSheet } from '@/diary/QuestionnaireSheet';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { visitScaleSeries } from '@/features/diary/dashboard/visit-scale-series';
import { dayKey } from '@/features/diary/diary-care';
import type { DiaryCheckpoint, DiaryEntry, DiaryInvitation } from '@/features/diary/diary-model';
import { DIARY_CLINICIAN_SCALES } from '@/features/diary/diary-questionnaires';
import {
  parseVisitScaleEntry,
  sortedVisitEntries,
  visitScaleEntry,
} from '@/features/diary/diary-visit-scales';
import '@/diary/diary-page.css';
import '@/diary/diary-care.css';

/** The synthetic checkpoint the shared questionnaire sheet fills; it is never part of the plan. */
function scaleCheckpoint(slug: string, label: string): DiaryCheckpoint {
  return { id: 'visit-scale', kind: 'questionnaire', label, questionnaire: slug };
}

/**
 * The doctor rates a clinician scale at a visit (HAM-D 17 and the like): pick the scale and the
 * day of the visit, answer in the same sheet the patient's questionnaires use, and the dated
 * rating is saved in the diary as the doctor's own. Earlier ratings are listed to open or remove.
 */
export function VisitScaleDialog(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  readonly invitation: DiaryInvitation;
  readonly onClose: () => void;
}): JSX.Element {
  const today = dayKey(new Date());
  const [day, setDay] = createSignal(today);
  const [open, setOpen] = createSignal<{ readonly scale: string; readonly entry?: DiaryEntry }>();
  const [removing, setRemoving] = createSignal<DiaryEntry>();
  const [error, setError] = createSignal('');
  const entries = (): DiaryEntry[] => sortedVisitEntries(props.patient.replica.visitScales);
  const [scored] = createResource(entries, (visits) => visitScaleSeries(visits));
  const labelOf = (slug: string): string =>
    DIARY_CLINICIAN_SCALES.find((scale) => scale.slug === slug)?.title ?? slug;
  /** «12 из 52, Умеренная» for a saved rating, once its scale is loaded. */
  const resultOf = (entry: DiaryEntry): string => {
    const point = (scored.latest ?? [])
      .flatMap((series) => series.points)
      .find((candidate) => candidate.entryId === entry.id);
    return point ? `${point.total} из ${point.max}, ${point.headline}` : '';
  };

  const save: CareSave = (value) => {
    const current = open();
    if (!current) return 'Шкала не выбрана.';
    try {
      const entry = parseVisitScaleEntry(
        props.invitation,
        visitScaleEntry({
          scale: current.scale,
          answers: value['answers'] as Record<string, number>,
          at: String(value['at']),
          id: String(value['id']),
        }),
      );
      setError('');
      setOpen(undefined);
      props.workspace.saveVisitScale(props.patient.summary.id, entry).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось сохранить оценку.');
      });
      return undefined;
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Оценка не подходит к дневнику.';
    }
  };

  const remove = (entry: DiaryEntry): void => {
    setError('');
    props.workspace.deleteVisitScale(props.patient.summary.id, entry.id).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить оценку.');
    });
  };

  return (
    <>
      <OverlayDialog
        open
        title="Оценка на приёме"
        subtitle="Шкала, которую заполняет врач"
        class="diary-dash-dialog"
        onClose={props.onClose}
      >
        <div class="diary-dash-form">
          <DateField
            label="Дата приёма"
            max={today}
            value={day()}
            onChange={(next) => setDay(next || today)}
          />
          <ul class="visit-scales" aria-label="Шкалы">
            <For each={DIARY_CLINICIAN_SCALES}>
              {(scale) => (
                <li class="visit-scales__item">
                  <button
                    type="button"
                    class="visit-scales__open"
                    data-testid={`visit-scale-${scale.slug}`}
                    onClick={() => setOpen({ scale: scale.slug })}
                  >
                    <AppGlyph name="list-checks" class="visit-scales__glyph" />
                    <span class="visit-scales__name">{scale.title}</span>
                    <span class="visit-scales__about">{scale.about}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={entries().length}>
            <ul class="visit-scales" aria-label="Сохранённые оценки">
              <For each={entries().toReversed()}>
                {(entry) => (
                  <li class="visit-scales__item visit-scales__item--saved">
                    <button
                      type="button"
                      class="visit-scales__open"
                      onClick={() => setOpen({ scale: entry.visitScale ?? '', entry })}
                    >
                      <span class="visit-scales__name">
                        {new Date(entry.at).toLocaleDateString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <span class="visit-scales__about">
                        {labelOf(entry.visitScale ?? '')} · {resultOf(entry)}
                      </span>
                    </button>
                    <Button
                      variant="icon"
                      aria-label="Удалить оценку"
                      icon={<AppGlyph name="trash" class="visit-scales__glyph" />}
                      onClick={() => setRemoving(entry)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={error()}>
            <p class="diary-dash__error" role="alert">
              {error()}
            </p>
          </Show>
        </div>
      </OverlayDialog>
      <div class="diary-care-scope" hidden />
      <Show when={open()}>
        {(current) => (
          <QuestionnaireSheet
            day={day()}
            checkpoint={scaleCheckpoint(current().scale, labelOf(current().scale))}
            entry={current().entry}
            onSave={save}
            onAlert={() => undefined}
            onClose={() => setOpen(undefined)}
          />
        )}
      </Show>
      <ConfirmationDialog
        open={removing() !== undefined}
        title="Удалить оценку?"
        description={<p>Она исчезнет с графика у вас и у кураторов.</p>}
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          const entry = removing();
          setRemoving(undefined);
          if (entry) remove(entry);
        }}
        onOpenChange={(next) => {
          if (!next) setRemoving(undefined);
        }}
      />
    </>
  );
}
