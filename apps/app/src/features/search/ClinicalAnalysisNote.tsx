import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SheetPopover } from '@/components/SheetPopover';
import { CLINICAL_STAGE_LABEL, type ClinicalStage } from '@/features/search/clinical-stages';

import './clinical-analysis-note.css';

/**
 * «Клинический разбор» above the results while the mode is on: one quiet line, the explanation of
 * what the mode does sits behind its «?» button instead of in the page. While the pass runs, the
 * row says which stage it is in and a thin bar moves along its bottom edge: progress in place,
 * never a spinner of its own.
 */
export function ClinicalAnalysisNote(props: {
  readonly stage?: ClinicalStage | undefined;
}): JSX.Element {
  const [helpOpen, setHelpOpen] = createSignal(false);
  return (
    <aside
      class="clinical-analysis-note"
      aria-label="О клиническом разборе"
      aria-busy={props.stage !== undefined}
    >
      <AppGlyph name="brain-fill" class="clinical-analysis-note__icon" />
      <span class="clinical-analysis-note__label">Клинический разбор</span>
      <span class="clinical-analysis-note__stage" role="status">
        <Show when={props.stage} keyed>
          {(stage) => (
            <span class="clinical-analysis-note__stage-text">{CLINICAL_STAGE_LABEL[stage]}</span>
          )}
        </Show>
      </span>
      <SheetPopover
        open={helpOpen()}
        onOpenChange={setHelpOpen}
        title="Клинический разбор"
        placement="bottom-end"
        triggerClass="clinical-analysis-note__help"
        triggerLabel="О клиническом разборе"
        triggerTitle="О клиническом разборе"
        trigger="?"
        contentClass="clinical-analysis-note__sheet"
      >
        <p class="clinical-analysis-note__text">
          Читает случай, описанный свободным текстом: выделяет симптомы, факты и отрицания и ищет
          рекомендации по смыслу. В выдаче — исходные документы.
        </p>
      </SheetPopover>
      <span
        class="clinical-analysis-note__progress"
        classList={{ 'clinical-analysis-note__progress--running': props.stage !== undefined }}
        aria-hidden="true"
      />
    </aside>
  );
}
