import { createMemo, createSignal, type JSX, Show } from 'solid-js';

import { NavBack } from '@/components/NavBack';
import { DiaryToday } from '@/diary/DiaryToday';
import { replicaResults } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { parseDiaryEntry } from '@/features/diary/diary-model';
import '@/diary/diary-care.css';

/**
 * One day of the patient's diary as the patient sees it, for the doctor: the same screen, opened
 * from the calendar. What the doctor saves or removes here becomes a correction the patient sees
 * marked; a curator who may only read sees it without changing anything.
 */
export function PatientDayView(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  /** Bumps when the workspace changes, so the screen follows live entries. */
  readonly version: number;
  readonly day: string;
  readonly onBack: () => void;
}): JSX.Element {
  const [error, setError] = createSignal('');
  const results = createMemo(() => {
    void props.version;
    return replicaResults(props.patient.replica);
  });
  const canEdit = (): boolean => props.patient.summary.role !== 'reader';
  const fail = (cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : 'Не удалось сохранить исправление.');
  };

  return (
    <div class="diary-day-view">
      <div class="diary-day-view__bar">
        <NavBack class="knowledge-back-button" aria-label="К пациенту" onClick={props.onBack} />
        <span class="diary-day-view__who">
          {props.patient.replica.profile?.emoji} {props.patient.replica.profile?.label}
        </span>
      </div>
      <Show when={error()}>
        <p class="diary-dash__error" role="alert">
          {error()}
        </p>
      </Show>
      <Show
        when={results()}
        fallback={<p class="diary-dash__quiet">План ещё не расшифрован на этом устройстве.</p>}
      >
        {(current) => (
          <DiaryToday
            viewer="doctor"
            initialDay={props.day}
            results={current()}
            status={{
              total: current().entries.length,
              unsent: 0,
              changed: 0,
              sentAt: undefined,
            }}
            consentAt={props.patient.replica.consentAt}
            tipsRead={[...props.patient.replica.tipsRead]}
            hasOtherDiaries={false}
            onSave={(value) => {
              if (!canEdit()) return 'Куратор с правом чтения не может исправлять записи.';
              try {
                const entry = parseDiaryEntry(current().invitation, value);
                setError('');
                props.workspace.correctEntry(props.patient.summary.id, entry).catch(fail);
                return undefined;
              } catch (cause) {
                return cause instanceof Error ? cause.message : 'Запись не подходит к плану.';
              }
            }}
            onRemove={(entry) => {
              if (!canEdit()) return;
              props.workspace.deleteEntry(props.patient.summary.id, entry.id).catch(fail);
            }}
            onConsent={() => undefined}
            onTipRead={() => undefined}
            onRecords={props.onBack}
            onSend={props.onBack}
            onMore={props.onBack}
            onList={props.onBack}
          />
        )}
      </Show>
    </div>
  );
}
