import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';

/** From this width the form is two columns (diary-dashboard.css `.diary-new__form`). */
const WIDE_QUERY = '(min-width: 60rem)';

/**
 * Room the page keeps under its last row (the padding of the form's ancestors). The sticky patient
 * column may be no taller than the window minus its top and this room: a taller column meets the
 * end of the form before the page has scrolled to its end and is pushed up under the pinned
 * header (e2e `diary-new-patient` «keeps its title below the pinned header»).
 */
function roomBelow(element: HTMLElement): number {
  let room = 0;
  for (let node = element.parentElement?.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    room += Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderBottomWidth);
  }
  return room;
}

/**
 * The patient card of «Новый пациент» and «Экран пациента» (owner 2026-11-10): on a wide screen the
 * doctor's form on the left and, on the right, what the patient's phone will show (blue, read-only);
 * on a phone the form alone, with a «Как увидит пациент» button that opens the same view in a sheet.
 * «Добавить пациента» / «Сохранить» sticks to the bottom of the form column on both. A `div`, not a
 * `form`: the past-treatment editor inside is a form of its own, and a nested submit must not
 * create the patient.
 */
export function PatientFormColumns(props: {
  /** Steps of the form, top to bottom (each a `FormStep`). */
  readonly steps: JSX.Element;
  /** The patient's screen. A function: it is drawn in one place at a time (column or sheet). */
  readonly view: (afterStep?: () => void) => JSX.Element;
  /** The error and the button: JSX written inline. */
  readonly footer: JSX.Element;
}): JSX.Element {
  const [wide, setWide] = createSignal(
    typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches,
  );
  const [showing, setShowing] = createSignal(false);
  onMount(() => {
    const media = window.matchMedia(WIDE_QUERY);
    const sync = (): void => {
      setWide(media.matches);
    };
    media.addEventListener('change', sync);
    onCleanup(() => media.removeEventListener('change', sync));
  });

  return (
    <div class="diary-dash-form diary-new__form">
      <div class="diary-new__steps">
        <Show when={!wide()}>
          <Button
            type="button"
            variant="secondary"
            class="diary-new__see"
            data-testid="patient-view-open"
            icon={<AppGlyph name="phone" class="diary-new__see-glyph" />}
            onClick={() => setShowing(true)}
          >
            Как увидит пациент
          </Button>
        </Show>
        {props.steps}
        <div class="diary-new__footer diary-new__footer--sticky">{props.footer}</div>
      </div>
      <Show when={wide()}>
        <div
          class="diary-new__view"
          ref={(view) => {
            const sync = (): void => {
              view.style.setProperty('--diary-new-bottom', `${Math.ceil(roomBelow(view))}px`);
            };
            requestAnimationFrame(sync);
            window.addEventListener('resize', sync);
            onCleanup(() => window.removeEventListener('resize', sync));
          }}
        >
          {props.view()}
        </div>
      </Show>
      <Show when={!wide() && showing()}>
        <OverlayDialog
          open
          title="Как увидит пациент"
          class="diary-new__view-dialog"
          onClose={() => setShowing(false)}
        >
          {props.view(() => setShowing(false))}
        </OverlayDialog>
      </Show>
    </div>
  );
}
