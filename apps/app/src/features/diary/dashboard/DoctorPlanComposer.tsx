import { createSignal, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { TextArea } from '@/components/TextArea';
import { VoiceNote } from '@/diary/VoiceNote';
import type { DoctorSession } from '@/features/diary/connected/doctor-account';
import { DICTATED_PLAN_TEXT_LIMIT, dictatedPlan } from '@/features/diary/dashboard/dictated-plan';
import {
  keepPatientPlanDraft,
  patientPlanDraft,
} from '@/features/diary/dashboard/new-patient-drafts';

export function DoctorPlanComposer(props: {
  readonly session: DoctorSession;
  readonly patientId: string;
  readonly openDraft: () => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [transcript, setTranscript] = createSignal('');
  const [recording, setRecording] = createSignal(false);
  const draft = () => patientPlanDraft(props.session, props.patientId);

  const collect = () => {
    if (recording()) return;
    const prepared = dictatedPlan(transcript());
    if (!prepared.rows.length) return;
    keepPatientPlanDraft(props.session, props.patientId, prepared);
    setTranscript('');
    setOpen(false);
  };

  return (
    <div class="diary-thread__plan-action">
      <Show
        when={draft()}
        fallback={
          <Button
            variant="quiet"
            icon={<AppGlyph name="microphone" class="diary-dash__glyph" />}
            onClick={() => setOpen(true)}
          >
            Надиктовать назначения
          </Button>
        }
      >
        <Button
          variant="secondary"
          icon={<AppGlyph name="list-checks" class="diary-dash__glyph" />}
          onClick={props.openDraft}
        >
          Открыть черновик назначений
        </Button>
      </Show>
      <Show when={open()}>
        <OverlayDialog
          open
          title="Надиктовать назначения"
          onClose={() => {
            setOpen(false);
            setRecording(false);
          }}
        >
          <div class="diary-plan-draft__capture">
            <VoiceNote
              wide
              transcriptOnly
              onActivityChange={setRecording}
              onText={(text) =>
                setTranscript((prior) =>
                  [prior.trim(), text.trim()]
                    .filter(Boolean)
                    .join('\n')
                    .slice(0, DICTATED_PLAN_TEXT_LIMIT),
                )
              }
            />
            <TextArea
              label="Расшифровка"
              placeholder="Препарат, доза и время. Каждое назначение с новой строки."
              rows={4}
              maxLength={DICTATED_PLAN_TEXT_LIMIT}
              value={transcript()}
              onInput={(event) => setTranscript(event.currentTarget.value)}
            />
            <Button
              variant="primary"
              disabled={recording() || !transcript().trim()}
              onClick={collect}
            >
              Собрать черновик
            </Button>
          </div>
        </OverlayDialog>
      </Show>
    </div>
  );
}
