import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import ecgPhotoExample from '@/assets/ecg-photo-example.jpg';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { EcgEditorCanvas } from './EcgEditorCanvas';
import { EcgEditorControls } from './EcgEditorControls';
import {
  ECG_CONFIRM_LABELS,
  EcgAutoSummary,
  EcgModelOffer,
  EcgStepGuide,
  EcgStepper,
} from './EcgEditorFlow';
import { EcgEditorReport } from './EcgEditorReport';
import { EcgNumericDiagnosticPanel } from './EcgNumericDiagnosticPanel';
import { EcgPhotoPicker } from './EcgPhotoPicker';
import { ECG_PHOTO_HANDOFF_EVENT, takeHandedOffEcgPhoto } from './ecg-photo-handoff';
import type { EcgMorphologyObservations } from './ecg-photo-interpreter';
import type { EcgEditorStep } from './ecgEditor';
import { useEcgEditor } from './useEcgEditor';
import '@/styles/ecg-photo-caliper.css';
import '@/styles/ecg-editor.css';
import '@/styles/ecg-editor-flow.css';

const TITLES = [
  'Загрузите ЭКГ',
  'Проверьте калибровку',
  'Проверьте отведения',
  'Проверьте точки зубцов',
  'Измерения и заключение',
] as const;

const BLOCKED_HINTS: Readonly<Record<Exclude<EcgEditorStep, 5>, string>> = {
  1: 'Сначала сфотографируйте ленту или выберите снимок.',
  2: 'Выберите скорость и отметьте 25 мм по горизонтали и 10 мм по вертикали.',
  3: 'Нужны рамки всех 12 отведений внутри снимка.',
  4: 'Нужны минимум две вершины R, начало и конец QRS.',
};

export function EcgPhotoCaliper(): JSX.Element {
  const editor = useEcgEditor();
  const [open, setOpen] = createSignal(true);
  const [numericOpen, setNumericOpen] = createSignal(false);
  const [numericMorphology, setNumericMorphology] = createSignal<EcgMorphologyObservations>({});
  const [calibrationTool, setCalibrationTool] = createSignal<'horizontal' | 'vertical' | 'pan'>(
    'pan',
  );
  const load = (file: File): void => {
    setOpen(true);
    void editor.load(file);
  };
  onMount(() => {
    // Keep-alive tool routes stay mounted, so a later home-screen photo arrives as an event.
    const receive = (): void => {
      const file = takeHandedOffEcgPhoto();
      if (file) load(file);
    };
    receive();
    window.addEventListener(ECG_PHOTO_HANDOFF_EVENT, receive);
    onCleanup(() => window.removeEventListener(ECG_PHOTO_HANDOFF_EVENT, receive));
  });
  const blockedHint = (): string | undefined => {
    const step = editor.step();
    if (step === 5 || editor.canConfirmStep()) return undefined;
    return step === 4 ? (editor.measurement().errors[0] ?? BLOCKED_HINTS[4]) : BLOCKED_HINTS[step];
  };
  return (
    <section class="ecg-entry" aria-label="Измерения по фото ЭКГ">
      <p class="ecg-entry__description">
        Пять шагов от фотографии до печатного заключения. Разметка остаётся на этом устройстве.
      </p>
      <button
        class="ecg-editor__button ecg-editor__button--primary"
        type="button"
        onClick={() => setOpen(true)}
      >
        {editor.photo() ? 'Продолжить разметку ЭКГ' : 'Открыть редактор ЭКГ'}
      </button>
      <button class="ecg-editor__button" type="button" onClick={() => setNumericOpen(true)}>
        Ввести готовые измерения
      </button>
      <OverlayDialog
        open={open()}
        title={TITLES[editor.step() - 1] ?? TITLES[0]}
        class="ecg-editor"
        headerClass="ecg-editor__header"
        bodyClass="ecg-editor__body"
        onClose={() => setOpen(false)}
      >
        <EcgStepper editor={editor} />
        <Show when={editor.step() === 1}>
          <div class="ecg-flow__panel">
            <div class="ecg-editor__upload-bar">
              <EcgPhotoPicker
                disabled={editor.loading()}
                replacing={Boolean(editor.photo())}
                onFile={load}
              />
              <span class="ecg-editor__hint">
                {editor.photo()
                  ? `${editor.photo()?.width} × ${editor.photo()?.height} · ${editor.photo()?.file.name}`
                  : 'JPEG, PNG или WebP · обработка на устройстве'}
              </span>
            </div>
            <Show when={!editor.model()}>
              <EcgModelOffer editor={editor} />
            </Show>
            <EcgAutoSummary editor={editor} />
            <EcgStepGuide step={1} padded />
          </div>
        </Show>
        <Show when={editor.step() >= 2 && editor.step() <= 4}>
          <EcgEditorControls
            editor={editor}
            calibrationTool={calibrationTool()}
            onCalibrationTool={setCalibrationTool}
          />
        </Show>
        <div class="ecg-editor__stage">
          <Show
            when={editor.step() === 5}
            fallback={
              <Show
                when={editor.photo()}
                fallback={
                  <div class="ecg-editor__welcome">
                    <div class="ecg-editor__welcome-copy">
                      <span class="ecg-editor__eyebrow">ПОЛУМАНУАЛЬНЫЙ АНАЛИЗ</span>
                      <h3 class="ecg-editor__welcome-title">Начнём с хорошего снимка</h3>
                      <p class="ecg-editor__welcome-text">
                        Снимайте сверху, расправьте лист и избегайте бликов. Все отведения, сетка,
                        скорость и усиление должны быть читаемы.
                      </p>
                    </div>
                    <div class="ecg-editor__examples">
                      <figure class="ecg-editor__example">
                        <img
                          class="ecg-editor__example-image"
                          src={ecgPhotoExample}
                          alt="Пример: все 12 отведений целиком в кадре"
                        />
                        <figcaption class="ecg-editor__example-caption">
                          Весь лист · ни одно отведение не обрезано
                        </figcaption>
                      </figure>
                      <figure class="ecg-editor__example">
                        <div class="ecg-editor__example-detail">
                          <img
                            class="ecg-editor__example-image ecg-editor__example-image--detail"
                            src={ecgPhotoExample}
                            alt="Увеличенный фрагмент: различимы сетка и зубцы"
                          />
                        </div>
                        <figcaption class="ecg-editor__example-caption">
                          Чёткая сетка · различимы мелкие зубцы
                        </figcaption>
                      </figure>
                    </div>
                    <p class="ecg-editor__hint ecg-editor__hint--on-photo">
                      Иллюстрации качества съёмки. Параметры берём только с вашей ЭКГ.
                    </p>
                  </div>
                }
              >
                <EcgEditorCanvas
                  editor={editor}
                  calibrationTool={calibrationTool()}
                  onCalibrationDone={() => setCalibrationTool('pan')}
                />
              </Show>
            }
          >
            <EcgEditorReport editor={editor} />
          </Show>
        </div>
        <footer class="ecg-editor__footer">
          <Show when={editor.error()}>
            <p class="ecg-editor__error" role="alert">
              {editor.error()}
            </p>
          </Show>
          <Show when={editor.digitizing() || (editor.notice() && editor.step() < 5)}>
            <p class="ecg-editor__status" role="status">
              <Show when={editor.digitizing()}>
                <span class="ecg-editor__busy-dot" />
              </Show>
              {editor.notice()}
            </p>
          </Show>
          <Show when={editor.loading()}>
            <p class="ecg-editor__status" role="status">
              Открываем фотографию…
            </p>
          </Show>
          <div class="ecg-flow-nav">
            <button
              class="ecg-flow-nav__back"
              type="button"
              aria-label="Предыдущий шаг"
              disabled={editor.step() === 1}
              onClick={() => editor.go((editor.step() - 1) as EcgEditorStep)}
            >
              <AppGlyph class="ecg-flow-nav__icon" name="caret-left" />
              Назад
            </button>
            <Show when={editor.step() < 5}>
              <button
                class="ecg-flow-nav__next"
                type="button"
                disabled={!editor.canConfirmStep()}
                aria-describedby={blockedHint() ? 'ecg-flow-blocked' : undefined}
                onClick={editor.confirmStep}
              >
                {ECG_CONFIRM_LABELS[editor.step() as Exclude<EcgEditorStep, 5>]}
                <AppGlyph class="ecg-flow-nav__icon" name="caret-right" />
              </button>
            </Show>
          </div>
          <Show when={blockedHint()}>
            {(hint) => (
              <p class="ecg-flow-nav__hint" id="ecg-flow-blocked">
                {hint()}
              </p>
            )}
          </Show>
        </footer>
      </OverlayDialog>
      <OverlayDialog
        open={numericOpen()}
        title="Готовые измерения ЭКГ"
        onClose={() => setNumericOpen(false)}
      >
        <EcgNumericDiagnosticPanel
          automaticAmplitudeValues={{}}
          automaticMeasurementsDraft={{}}
          exampleMode={false}
          measurements={{}}
          morphology={numericMorphology()}
          onMorphologyChange={(id, value) =>
            setNumericMorphology((current) => ({ ...current, [id]: value }))
          }
          studyRevision={0}
        />
      </OverlayDialog>
    </section>
  );
}
