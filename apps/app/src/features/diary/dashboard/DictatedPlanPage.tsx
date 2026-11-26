import { createSignal, For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { ScreenHeader } from '@/diary/diary-ui';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import {
  type DictatedPlan,
  type DictatedPlanRow,
  dictatedRowIssue,
} from '@/features/diary/dashboard/dictated-plan';
import {
  keepPatientPlanDraft,
  patientPlanDraft,
} from '@/features/diary/dashboard/new-patient-drafts';
import {
  type CareSectionDraft,
  careInvitationParts,
  emptyCareDraft,
} from '@/features/diary/diary-care-draft';
import { parseDiaryInvitation } from '@/features/diary/diary-model';
import { MedHistoryContext } from '@/features/diary/med-history/plan-removals';
import { DrugFields } from '@/features/diary/PatientScreenEditor';

function DraftRow(props: {
  readonly row: DictatedPlanRow;
  readonly error: string | undefined;
  readonly patch: (patch: Partial<CareSectionDraft>) => void;
  readonly remove: () => void;
}): JSX.Element {
  return (
    <article class="diary-plan-draft__row">
      <div class="diary-plan-draft__source">
        <blockquote class="diary-plan-draft__quote">{props.row.source}</blockquote>
        <Button
          variant="icon"
          aria-label="Убрать назначение из черновика"
          icon={<AppGlyph name="trash" class="diary-dash__glyph" />}
          onClick={props.remove}
        />
      </div>
      <DrugFields
        section={props.row.section}
        chosen
        onChosen={() => undefined}
        patch={props.patch}
        reviewingDictation
      />
      <Show when={props.error}>
        <p class="diary-dash__error" role="alert">
          {props.error}
        </p>
      </Show>
    </article>
  );
}

export function DictatedPlanPage(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  readonly onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [checked, setChecked] = createSignal(false);
  const [discard, setDiscard] = createSignal(false);
  const session = props.workspace.session;
  const patientId = props.patient.summary.id;
  const draft = () => patientPlanDraft(session, patientId);
  const keep = (next?: DictatedPlan) => keepPatientPlanDraft(session, patientId, next);
  const editable = () =>
    props.patient.summary.role !== 'reader' && props.patient.summary.status === 'active';
  const history = () => Object.values(props.patient.replica.medHistory ?? {});
  const save = async () => {
    if (busy() || !editable()) return;
    const base = props.workspace.patient(patientId)?.replica.invitation;
    const rows = draft()?.rows ?? [];
    if (!base || !rows.length) return;
    setChecked(true);
    setError('');
    if (rows.some(({ section }) => dictatedRowIssue(section))) return;

    const previous = base.plan ?? [];
    const knownIds = new Set(previous.map((item) => item.id));
    const sections = rows
      .map(({ section }) => section)
      .filter((section) => !section.id || !knownIds.has(section.id));
    if (!sections.length) {
      keep();
      props.onClose();
      return;
    }
    setBusy(true);
    try {
      const added = careInvitationParts({ ...emptyCareDraft(), sections }).plan;
      const invitation = parseDiaryInvitation({ ...base, plan: [...previous, ...added] });
      await props.workspace.writePlan(patientId, invitation, base);
      keep();
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить назначения.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="diary-plan-draft">
      <ScreenHeader signum title="Черновик назначений" backLabel="К чату" onBack={props.onClose} />
      <Show
        when={editable() && draft()}
        fallback={<p class="diary-plan-draft__empty">Черновика назначений нет.</p>}
      >
        {(current) => (
          <div class="diary-plan-draft__body">
            <div class="diary-plan-draft__body" inert={busy()}>
              <MedHistoryContext.Provider value={history}>
                <For each={current().rows.map(({ section }) => section.key)}>
                  {(key) => (
                    <Show when={current().rows.find(({ section }) => section.key === key)}>
                      {(row) => (
                        <DraftRow
                          row={row()}
                          error={checked() ? dictatedRowIssue(row().section) : undefined}
                          patch={(patch) =>
                            keep({
                              rows: current().rows.map((item) =>
                                item.section.key === key
                                  ? { ...item, section: { ...item.section, ...patch } }
                                  : item,
                              ),
                            })
                          }
                          remove={() =>
                            keep({
                              rows: current().rows.filter((item) => item.section.key !== key),
                            })
                          }
                        />
                      )}
                    </Show>
                  )}
                </For>
              </MedHistoryContext.Provider>
            </div>
            <Show when={error()}>
              <p class="diary-dash__error" role="alert">
                {error()}
              </p>
            </Show>
            <div class="diary-plan-draft__actions">
              <Button variant="quiet" disabled={busy()} onClick={() => setDiscard(true)}>
                Удалить черновик
              </Button>
              <Button
                variant="primary"
                disabled={busy() || !current().rows.length}
                onClick={() => void save()}
              >
                {busy() ? 'Отправляем…' : 'Подтвердить и отправить'}
              </Button>
            </div>
          </div>
        )}
      </Show>
      <ConfirmationDialog
        open={discard()}
        title="Удалить черновик?"
        description={<p>Назначения из черновика будут удалены с этого устройства.</p>}
        confirmLabel="Удалить"
        danger
        onOpenChange={setDiscard}
        onConfirm={() => {
          setDiscard(false);
          keep();
        }}
      />
    </main>
  );
}
