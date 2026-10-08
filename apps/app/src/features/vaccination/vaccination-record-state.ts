import { type Accessor, createEffect, createSignal, on, onCleanup } from 'solid-js';

import {
  buildRecord,
  type DoseMarks,
  loadRecord,
  saveRecord,
} from '@/features/vaccination/vaccination-record';

/** Edits are saved this long after the last one, so a run of taps is one write. */
export const RECORD_SAVE_DELAY_MS = 600;

export interface RecordState {
  readonly marks: Accessor<DoseMarks>;
  /** False while the card's marks are being read; the screen shows no statuses until then. */
  readonly ready: Accessor<boolean>;
  /** A damaged or unwritable record, shown instead of being hidden. */
  readonly problem: Accessor<string>;
  readonly update: (next: DoseMarks) => void;
}

/**
 * The marks of the child on the screen. With a card they are read from the card's patient file and
 * saved back (debounced) as the doctor edits; without one (only a birth date) they live on this
 * page and are never written anywhere. Switching card saves the previous card's pending edit first.
 */
export function createRecordState(
  calendarId: string,
  patientId: Accessor<string | undefined>,
): RecordState {
  const [marks, setMarks] = createSignal<DoseMarks>({});
  const [ready, setReady] = createSignal(true);
  const [problem, setProblem] = createSignal('');
  let pending: { readonly id: string; readonly marks: DoseMarks } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;
  // A record that could not be read is never overwritten by what the doctor marks afterwards.
  let writable = true;

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const job = pending;
    pending = undefined;
    if (!job) return;
    void saveRecord(job.id, buildRecord(calendarId, job.marks, new Date())).catch(
      (cause: unknown) => {
        setProblem(cause instanceof Error ? cause.message : 'Не удалось сохранить отметки.');
      },
    );
  };

  createEffect(
    on(patientId, (id) => {
      flush();
      const mine = ++request;
      setProblem('');
      setMarks({});
      writable = true;
      if (!id) {
        setReady(true);
        return;
      }
      setReady(false);
      void loadRecord(id)
        .then((record) => {
          if (mine !== request) return;
          setMarks(record?.marks ?? {});
        })
        .catch((cause: unknown) => {
          if (mine !== request) return;
          writable = false;
          setProblem(
            `${cause instanceof Error ? cause.message : 'Не удалось прочитать отметки.'} Новые отметки не сохраняются.`,
          );
        })
        .finally(() => {
          if (mine === request) setReady(true);
        });
    }),
  );
  onCleanup(() => {
    request += 1;
    flush();
  });

  return {
    marks,
    ready,
    problem,
    update: (next) => {
      if (!ready()) return;
      setMarks(next);
      const id = patientId();
      if (!id || !writable) return;
      pending = { id, marks: next };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, RECORD_SAVE_DELAY_MS);
    },
  };
}
