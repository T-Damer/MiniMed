import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

import './clinical-analysis-note.css';

/** What «Клинический разбор» is, shown above the results while the mode is on. */
export function ClinicalAnalysisNote(): JSX.Element {
  return (
    <aside class="clinical-analysis-note" aria-label="О клиническом разборе">
      <AppGlyph name="brain-fill" class="clinical-analysis-note__icon" />
      <p class="clinical-analysis-note__text">
        Клинический разбор читает случай, описанный свободным текстом: выделяет симптомы, факты и
        отрицания и ищет рекомендации по смыслу. В выдаче источники, а не диагноз.
      </p>
    </aside>
  );
}
