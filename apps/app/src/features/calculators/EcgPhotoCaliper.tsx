import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import ecgPhotoExample from '@/assets/ecg-photo-example.jpg';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { toolWorkspace } from '@/state/tool-navigation';
import { ECG_PHOTO_CALIPER_ID } from './calculator-registry';
import { EcgEditorCanvas } from './EcgEditorCanvas';
import { EcgEditorControls } from './EcgEditorControls';
import {
  ECG_CONFIRM_LABELS,
  EcgAutoSummary,
  EcgHelpButton,
  EcgModelOffer,
  EcgModelUpdateNotice,
  EcgPerspectivePanel,
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

/**
 * The editor is a full-screen flow, not a page: as the ECG tool route (`onExit` given) it has no
 * description page behind it, closing it leaves the route for where the user came from, and
 * opening the route again reopens it. Inline (no `onExit`) it keeps a small launcher.
 */
export function EcgPhotoCaliper(props: { readonly onExit?: () => void }): JSX.Element {
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
    // The route stays mounted after the editor is closed, so entering it again reopens the editor.
    if (!props.onExit) return;
    const reopen = (): void => {
      if (toolWorkspace(window.location.hash) === `calculators/${ECG_PHOTO_CALIPER_ID}`)
        setOpen(true);
    };
    window.addEventListener('hashchange', reopen);
    onCleanup(() => window.removeEventListener('hashchange', reopen));
  });
  const closeEditor = (): void => {
    setOpen(false);
    props.onExit?.();
  };
  const closeNumeric = (): void => {
    setNumericOpen(false);
    // Back to the editor the numbers came from (or the one the user opened them beside).
    if (props.onExit) setOpen(true);
  };
  const blockedHint = (): string | undefined => {
    const step = editor.step();
    if (step === 5 || editor.canConfirmStep()) return undefined;
    return step === 4 ? (editor.measurement().errors[0] ?? BLOCKED_HINTS[4]) : BLOCKED_HINTS[step];
  };
  return (
    <section class="ecg-entry" aria-label="Измерения по фото ЭКГ">
      <Show when={!props.onExit}>
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
      </Show>
      <OverlayDialog
        open={open()}
        title={TITLES[editor.step() - 1] ?? TITLES[0]}
        class="ecg-editor"
        presentation="screen"
        headerClass="ecg-editor__header"
        bodyClass="ecg-editor__body"
        headerEnd={<EcgHelpButton step={editor.step()} />}
        onClose={closeEditor}
      >
        <Show when={editor.photo()}>
          <EcgStepper editor={editor} />
        </Show>
        <Show when={editor.step() === 1}>
          <div class="ecg-flow__panel">
            <div class="ecg-editor__upload-bar">
              <EcgPhotoPicker
                disabled={editor.loading()}
                replacing={Boolean(editor.photo())}
                stretch
                stack={!editor.photo()}
                extra={
                  <Show when={props.onExit}>
                    <button
                      class="ecg-picker__option ecg-picker__option--stretch"
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setNumericOpen(true);
                      }}
                    >
                      <AppGlyph class="ecg-picker__icon" name="list-checks" />
                      Ввести измерения
                    </button>
                  </Show>
                }
                onFile={load}
              />
            </div>
            <Show when={editor.photo()}>
              {(photo) => (
                <span class="ecg-editor__hint ecg-editor__file">
                  {photo().width} × {photo().height} · {photo().file.name}
                </span>
              )}
            </Show>
            <EcgPerspectivePanel editor={editor} />
            <Show when={!editor.model()}>
              <EcgModelOffer editor={editor} />
            </Show>
            <EcgModelUpdateNotice editor={editor} />
            <EcgAutoSummary editor={editor} />
          </div>
        </Show>
        <Show when={editor.step() >= 2 && editor.step() <= 4}>
          <EcgEditorControls
            editor={editor}
            calibrationTool={calibrationTool()}
            onCalibrationTool={setCalibrationTool}
          />
        </Show>
        <div
          class="ecg-editor__stage"
          classList={{ 'ecg-editor__stage--idle': !editor.photo() && editor.step() !== 5 }}
        >
          <Show
            when={editor.step() === 5}
            fallback={
              <Show
                when={editor.photo()}
                fallback={
                  <div class="ecg-editor__welcome">
                    <div class="ecg-editor__examples">
                      <figure class="ecg-editor__example">
                        <img
                          class="ecg-editor__example-image"
                          src={ecgPhotoExample}
                          alt="Пример: все 12 отведений целиком в кадре"
                        />
                        <figcaption class="ecg-editor__example-caption">
                          Весь лист в кадре
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
                        <figcaption class="ecg-editor__example-caption">Чёткая сетка</figcaption>
                      </figure>
                    </div>
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
            <EcgEditorReport
              editor={editor}
              onOpenNumeric={() => {
                setOpen(false);
                setNumericOpen(true);
              }}
            />
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
      <OverlayDialog open={numericOpen()} title="Готовые измерения ЭКГ" onClose={closeNumeric}>
        <EcgNumericDiagnosticPanel
          automaticAmplitudeValues={editor.numericDraft()?.amplitudes ?? {}}
          automaticMeasurementsDraft={editor.numericDraft()?.measurements ?? {}}
          {...(editor.numericDraft()
            ? {
                draftNotes: {
                  missing: editor.numericDraft()?.missing ?? {},
                  sources: editor.numericDraft()?.sources ?? {},
                },
              }
            : {})}
          exampleMode={false}
          measurements={{}}
          morphology={numericMorphology()}
          onMorphologyChange={(id, value) =>
            setNumericMorphology((current) => ({ ...current, [id]: value }))
          }
          studyRevision={editor.studyRevision()}
        />
      </OverlayDialog>
    </section>
  );
}
