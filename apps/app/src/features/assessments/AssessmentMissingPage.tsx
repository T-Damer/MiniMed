import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { AssessmentBackNav } from '@/features/assessments/AssessmentBackNav';

export function AssessmentMissingPage(props: {
  readonly sectionTitle: string;
  readonly title: string;
  readonly onBack: () => void;
  readonly onInstall: () => void;
}): JSX.Element {
  return (
    <div class="assessment-workspace">
      <Page
        class="assessment-page-header"
        navigation={
          <AssessmentBackNav sectionTitle={props.sectionTitle} onBackToCatalog={props.onBack} />
        }
        icon={<AppGlyph name="list-checks" class="page__icon-glyph" />}
        title={
          <Heading depth={3} class="assessment-subpage-title">
            {props.title}
          </Heading>
        }
        description={props.sectionTitle}
      />

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
