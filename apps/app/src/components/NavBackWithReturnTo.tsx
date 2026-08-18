import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  consumeAndRestoreReturnTo,
  peekReturnTo,
  RETURN_TO_EVENT,
  returnToControlIcon,
  returnToControlLabel,
  returnToRouteDetail,
} from '@/state/return-navigation';

export function NavBackWithReturnTo(props: {
  readonly catalogLabel: string;
  readonly catalogDetail: string;
  readonly catalogIcon?: AppGlyphName;
  readonly catalogAriaLabel: string;
  readonly onBackToCatalog: () => void;
  readonly buttonClass?: string;
  readonly chooserClass?: string;
}): JSX.Element {
  const [returnTo, setReturnTo] = createSignal(peekReturnTo());
  const [chooserOpen, setChooserOpen] = createSignal(false);

  onMount(() => {
    const syncReturnTo = () => {
      setReturnTo(peekReturnTo());
    };
    window.addEventListener(RETURN_TO_EVENT, syncReturnTo);
    onCleanup(() => window.removeEventListener(RETURN_TO_EVENT, syncReturnTo));
  });

  const closeChooser = (): void => {
    setChooserOpen(false);
  };

  const navigateToCatalog = (): void => {
    closeChooser();
    props.onBackToCatalog();
  };

  const navigateToReturnTo = (): void => {
    closeChooser();
    consumeAndRestoreReturnTo();
  };

  const buttonClass = (): string => props.buttonClass ?? 'knowledge-back-button';

  return (
    <Show
      when={returnTo()}
      fallback={
        <NavBack
          class={buttonClass()}
          aria-label={props.catalogAriaLabel}
          onClick={props.onBackToCatalog}
        />
      }
    >
      {(destination) => (
        <>
          <NavBack
            class={buttonClass()}
            aria-label="Куда вернуться"
            aria-expanded={chooserOpen()}
            onClick={() => setChooserOpen(true)}
          />
          <OverlayDialog
            open={chooserOpen()}
            title="Куда вернуться"
            class={props.chooserClass ?? 'assessment-back-chooser'}
            bodyClass="assessment-back-chooser__cards"
            onClose={closeChooser}
          >
            <button type="button" class="assessment-back-chooser__card" onClick={navigateToCatalog}>
              <AppGlyph
                name={props.catalogIcon ?? 'list-checks'}
                class="assessment-back-chooser__card-icon"
              />
              <span class="assessment-back-chooser__card-title">{props.catalogLabel}</span>
              <span class="assessment-back-chooser__card-detail">{props.catalogDetail}</span>
            </button>
            <button
              type="button"
              class="assessment-back-chooser__card"
              onClick={navigateToReturnTo}
            >
              <AppGlyph
                name={returnToControlIcon(destination())}
                class="assessment-back-chooser__card-icon"
              />
              <span class="assessment-back-chooser__card-title">
                {returnToControlLabel(destination())}
              </span>
              <span class="assessment-back-chooser__card-detail">
                {returnToRouteDetail(destination())}
              </span>
            </button>
          </OverlayDialog>
        </>
      )}
    </Show>
  );
}
