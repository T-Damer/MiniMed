import { createSignal, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SheetPopover } from '@/components/SheetPopover';

import './clinical-analysis-note.css';

/**
 * «Клинический разбор» above the results while the mode is on: one quiet line, the explanation of
 * what the mode does sits behind its «?» button instead of in the page.
 */
export function ClinicalAnalysisNote(): JSX.Element {
  const [helpOpen, setHelpOpen] = createSignal(false);
  return (
    <aside class="clinical-analysis-note" aria-label="О клиническом разборе">
      <AppGlyph name="brain-fill" class="clinical-analysis-note__icon" />
      <span class="clinical-analysis-note__label">Клинический разбор</span>
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
          рекомендации по смыслу. В выдаче источники, а не диагноз.
        </p>
      </SheetPopover>
    </aside>
  );
}
