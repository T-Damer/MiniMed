import { createMemo, createSignal, For, type JSX } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  type AssessmentPrintOptions,
  assessmentRecordPrintHtml,
  DEFAULT_ASSESSMENT_PRINT,
  type PrintOrientation,
  printAssessmentHtml,
} from '@/features/assessments/assessment-print';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
import { PaperPreview } from '@/features/printing/PaperPreview';

import '@/features/assessments/assessment-print-dialog.css';

/** A4 at 96 dpi: the sheet the preview draws, turned with the orientation. */
const A4 = { short: 794, long: 1123 } as const;

type PartKey = 'questions' | 'answers' | 'results' | 'chart';

const PARTS: readonly {
  readonly key: PartKey;
  readonly label: string;
  readonly icon: AppGlyphName;
}[] = [
  { key: 'results', label: 'Результат', icon: 'notes' },
  { key: 'chart', label: 'График', icon: 'chart-line' },
  { key: 'questions', label: 'Вопросы', icon: 'list-checks' },
  { key: 'answers', label: 'Ответы', icon: 'check' },
];

/**
 * «Печать» of a questionnaire result (owner 2026-11-06): the sheet as it will print, the page turned
 * upright or on its side, and what goes on it — result, chart, questions, the answers given. The
 * preview is the printed document itself, so it shows exactly what comes out.
 */
export function AssessmentPrintDialog(props: {
  readonly open: boolean;
  readonly definition: AssessmentDefinition;
  readonly record: AssessmentRecord;
  readonly noteTitle: string;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
}): JSX.Element {
  const [options, setOptions] = createSignal<AssessmentPrintOptions>(DEFAULT_ASSESSMENT_PRINT);
  const completed = (): boolean => props.record.kind === 'completed';
  const html = createMemo(() =>
    assessmentRecordPrintHtml(props.definition, props.record, props.noteTitle, options()),
  );
  const landscape = (): boolean => options().orientation === 'landscape';
  const toggle = (key: PartKey): void => {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  };
  const nothingChosen = (): boolean =>
    !options().results && !options().chart && !options().questions && !options().answers;
  const print = (): void => {
    if (!printAssessmentHtml(html(), props.definition.title)) {
      props.onError('Не удалось открыть окно печати.');
    }
  };
  return (
    <OverlayDialog
      open={props.open}
      title="Печать"
      presentation="screen"
      class="assessment-print"
      bodyClass="assessment-print__body"
      onClose={props.onClose}
      headerEnd={
        <Button
          type="button"
          variant="primary"
          class="assessment-print__print"
          aria-label="Печать"
          title="Печать"
          disabled={nothingChosen()}
          icon={<AppGlyph name="printer" />}
          onClick={print}
        />
      }
    >
      <div class="assessment-print__controls">
        <SegmentedControl<PrintOrientation>
          label="Ориентация страницы"
          stretch
          value={options().orientation}
          options={[
            { value: 'portrait', label: 'Книжная' },
            { value: 'landscape', label: 'Альбомная' },
          ]}
          onChange={(orientation) => setOptions((current) => ({ ...current, orientation }))}
        />
        <fieldset class="assessment-print__parts">
          <legend class="sr-only">Что печатать</legend>
          <For each={PARTS}>
            {(part) => (
              <button
                type="button"
                class="assessment-print__part"
                classList={{ 'assessment-print__part--on': options()[part.key] }}
                aria-pressed={options()[part.key]}
                disabled={part.key !== 'results' && !completed()}
                onClick={() => toggle(part.key)}
              >
                <AppGlyph name={part.icon} class="assessment-print__part-icon" />
                {part.label}
              </button>
            )}
          </For>
        </fieldset>
      </div>
      <PaperPreview
        title="Предпросмотр печати"
        html={html()}
        sheetWidth={landscape() ? A4.long : A4.short}
        sheetMinHeight={landscape() ? A4.short : A4.long}
      />
    </OverlayDialog>
  );
}
