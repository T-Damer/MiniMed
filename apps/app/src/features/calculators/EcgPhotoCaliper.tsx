import { createSignal, type JSX, Show } from 'solid-js';
import ecgPhotoExample from '@/assets/ecg-photo-example.jpg';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { EcgEditorCanvas } from './EcgEditorCanvas';
import { EcgEditorConfirmation, EcgEditorControls } from './EcgEditorControls';
import { EcgEditorReport } from './EcgEditorReport';
import { EcgNumericDiagnosticPanel } from './EcgNumericDiagnosticPanel';
import type { EcgMorphologyObservations } from './ecg-photo-interpreter';
import type { EcgEditorStep } from './ecgEditor';
import { useEcgEditor } from './useEcgEditor';
import '@/styles/ecg-photo-caliper.css';
import '@/styles/ecg-editor.css';

const TITLES = [
  'Загрузите ЭКГ',
  'Проверьте калибровку',
  'Проверьте отведения',
  'Проверьте точки зубцов',
  'Измерения и заключение',
] as const;

export function EcgPhotoCaliper(): JSX.Element {
  const editor = useEcgEditor();
  const [open, setOpen] = createSignal(true);
  const [numericOpen, setNumericOpen] = createSignal(false);
  const [numericMorphology, setNumericMorphology] = createSignal<EcgMorphologyObservations>({});
  const [calibrationTool, setCalibrationTool] = createSignal<'horizontal' | 'vertical' | 'pan'>(
    'pan',
  );
  const load = (event: Event & { currentTarget: HTMLInputElement }): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    void editor.load(file);
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
        <Show when={editor.step() === 1}>
          <div class="ecg-editor__upload-bar">
            <label class="ecg-editor__button ecg-editor__button--primary ecg-editor__upload-button">
              <AppGlyph class="ecg-editor__icon" name="image" />
              {editor.photo() ? 'Заменить фото' : 'Выбрать фото'}
              <input
                class="ecg-editor__file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Загрузить ЭКГ"
                onChange={load}
                disabled={editor.loading()}
              />
            </label>
            <span class="ecg-editor__hint">
              {editor.photo()
                ? `${editor.photo()?.width} × ${editor.photo()?.height} · ${editor.photo()?.file.name}`
                : 'JPEG, PNG или WebP · обработка на устройстве'}
            </span>
            <Show when={!editor.model()}>
              <button
                class="ecg-editor__button"
                type="button"
                onClick={() => void editor.install()}
              >
                {editor.installing()
                  ? `Отменить установку · ${Math.round(editor.progress() * 100)}%`
                  : 'Установить авторазметку · 19 МБ'}
              </button>
            </Show>
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
          <button
            class="ecg-editor__arrow ecg-editor__arrow--back"
            type="button"
            aria-label="Предыдущий шаг"
            title="Предыдущий шаг"
            disabled={editor.step() === 1}
            onClick={() => editor.go((editor.step() - 1) as EcgEditorStep)}
          >
            <AppGlyph class="ecg-editor__arrow-icon" name="caret-left" />
          </button>
          <Show when={editor.step() < 5}>
            <button
              class="ecg-editor__arrow ecg-editor__arrow--next"
              type="button"
              aria-label="Следующий шаг"
              title="Следующий шаг"
              disabled={!editor.completed().slice(0, editor.step()).every(Boolean)}
              onClick={() => editor.go((editor.step() + 1) as EcgEditorStep)}
            >
              <AppGlyph class="ecg-editor__arrow-icon" name="caret-right" />
            </button>
          </Show>
        </div>
        <footer class="ecg-editor__footer">
          <Show when={editor.step() < 5}>
            <EcgEditorConfirmation editor={editor} />
          </Show>
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
