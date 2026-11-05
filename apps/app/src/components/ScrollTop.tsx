import { createEffect, createSignal, type JSX, on, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { FLOATING_CONTROLS_HOST_ID } from '@/components/FloatingActionButton';
import { motionMs } from '@/state/motion';

import '@/components/scroll-top.css';

/** The button appears once the page is scrolled past this many screens. */
const SHOW_AFTER_SCREENS = 1.5;
/** The fade matches `--motion-base`; the button leaves the layout once it has faded. */
const FADE_MS = 180;

export interface ScrollTopProps {
  /**
   * A scroller of its own (a full-screen reader) that takes over from the page while it exists;
   * called on every scroll, so it may come and go.
   */
  readonly scroller?: () => HTMLElement | null | undefined;
}

function withoutMotion(): boolean {
  return motionMs(1) === 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * «Наверх»: a round button at the bottom-right, above the floating bottom bar, that fades in after
 * the page is scrolled down more than a screen and a half and scrolls back to the top. Mounted
 * once in the main app's shell and once in the patient diary. It joins the app's floating-controls
 * column when there is one (so it never overlaps the other floating buttons) and otherwise fixes
 * itself above the bar.
 */
export function ScrollTop(props: ScrollTopProps): JSX.Element {
  const [host, setHost] = createSignal<HTMLElement | null | undefined>(undefined);
  const [far, setFar] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [shown, setShown] = createSignal(false);

  const scrolledFar = (): boolean => {
    const scroller = props.scroller?.();
    if (scroller) return scroller.scrollTop > scroller.clientHeight * SHOW_AFTER_SCREENS;
    return window.scrollY > window.innerHeight * SHOW_AFTER_SCREENS;
  };

  onMount(() => {
    setHost(document.getElementById(FLOATING_CONTROLS_HOST_ID));
    let frame: number | undefined;
    const check = (): void => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setFar(scrolledFar());
      });
    };
    // Capture: a full-screen reader scrolls inside itself and its scroll events do not bubble.
    document.addEventListener('scroll', check, { capture: true, passive: true });
    window.addEventListener('resize', check, { passive: true });
    setFar(scrolledFar());
    onCleanup(() => {
      document.removeEventListener('scroll', check, { capture: true });
      window.removeEventListener('resize', check);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });

  // In: mount, then show a frame later so the transition has a start. Out: fade, then unmount.
  createEffect(
    on(far, (isFar) => {
      if (isFar) {
        setMounted(true);
        const frame = requestAnimationFrame(() => setShown(true));
        onCleanup(() => cancelAnimationFrame(frame));
        return;
      }
      setShown(false);
      const timer = window.setTimeout(() => setMounted(false), motionMs(FADE_MS));
      onCleanup(() => window.clearTimeout(timer));
    }),
  );

  const scrollToTop = (): void => {
    const scroller = props.scroller?.();
    const target: Pick<Element | Window, 'scrollTo'> = scroller ?? window;
    const position = (): number => (scroller ? scroller.scrollTop : window.scrollY);
    target.scrollTo({ top: 0, behavior: withoutMotion() ? 'auto' : 'smooth' });
    // A list that measures its rows while the page scrolls can make the smooth scroll stop short:
    // when it ends away from the top, finish the job at once.
    document.addEventListener(
      'scrollend',
      () => {
        if (position() > 1) target.scrollTo({ top: 0, behavior: 'auto' });
      },
      { once: true },
    );
  };

  const button = (inHost: boolean): JSX.Element => (
    <Button
      type="button"
      variant="icon"
      class={`scroll-top-button${inHost ? '' : ' scroll-top-button--fixed'}${shown() ? ' scroll-top-button--shown' : ''}`}
      aria-label="Наверх"
      title="Наверх"
      onClick={scrollToTop}
      icon={<AppGlyph name="arrow-up" class="scroll-top-button__icon" />}
    />
  );

  return (
    <Show when={mounted() && host() !== undefined}>
      <Show when={host()} fallback={button(false)}>
        {(mount) => <Portal mount={mount()}>{button(true)}</Portal>}
      </Show>
    </Show>
  );
}
