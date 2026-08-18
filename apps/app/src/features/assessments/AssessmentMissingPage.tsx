import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { AssessmentBackNav } from '@/features/assessments/AssessmentBackNav';

export function AssessmentMissingPage(props: {
  readonly sectionTitle: string;
  readonly title: string;
  readonly onBack: () => void;
  readonly onInstall: () => void;
}): JSX.Element {
  return (
    <div class="assessment-workspace">
      <header class="assessment-subpage-header">
        <div class="assessment-subpage-header-actions assessment-subpage-header-actions--leading">
          <AssessmentBackNav sectionTitle={props.sectionTitle} onBackToCatalog={props.onBack} />
        </div>
        <div class="assessment-subpage-header__content">
          <p class="archive-kicker">{props.sectionTitle}</p>
          <h1 class="assessment-subpage-title">{props.title}</h1>
        </div>
      </header>

      <section class="assessment-missing-body paper-card" aria-live="polite">
        <p class="assessment-missing-body__lead">
          Этот опросник ещё не установлен на устройстве. Скачайте его, чтобы пройти тест без сети.
        </p>
        <p class="assessment-missing-body__hint">
          После установки откроется рабочая область с вопросами и методикой — как для уже скачанных
          тестов.
        </p>
        <div class="assessment-missing-body__actions">
          <Button
            class="assessment-missing-body__button"
            type="button"
            onClick={props.onInstall}
            icon={<AppGlyph name="download" />}
          >
            Скачать только этот тест
          </Button>
        </div>
      </section>
    </div>
  );
}
