import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

/** From this width the form is two columns (diary-dashboard.css `.diary-new__form`). */
const WIDE_QUERY = '(min-width: 60rem)';

/**
 * The patient form of «Новый пациент» and «Экран пациента»: on a phone one column (details, the
 * patient's screen, the button); on a wide screen the details and the button stay in view on the
 * left while the long preview of the screen scrolls on the right (owner 2026-11-02). The footer is
 * moved between the two places, never the details or the screen: they keep their state.
 */
export function PatientFormColumns(props: {
  readonly identity: JSX.Element;
  readonly screen: JSX.Element;
  /** The error and the button: read once per place, so it must be JSX written inline. */
  readonly footer: JSX.Element;
  readonly onSubmit: (event: SubmitEvent) => void;
}): JSX.Element {
  const [wide, setWide] = createSignal(
    typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches,
  );
  onMount(() => {
    const media = window.matchMedia(WIDE_QUERY);
    const sync = (): void => {
      setWide(media.matches);
    };
    media.addEventListener('change', sync);
    onCleanup(() => media.removeEventListener('change', sync));
  });

  return (
    <form class="diary-dash-form diary-new__form" onSubmit={(event) => props.onSubmit(event)}>
      <div class="diary-new__side">
        <div class="diary-new__identity">{props.identity}</div>
        <Show when={wide()}>
          <div class="diary-new__footer">{props.footer}</div>
        </Show>
      </div>
      <div class="diary-new__screen">{props.screen}</div>
      <Show when={!wide()}>
        <div class="diary-new__footer">{props.footer}</div>
      </Show>
    </form>
  );
}
