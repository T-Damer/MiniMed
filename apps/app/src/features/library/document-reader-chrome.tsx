import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-solid';
import { createEffect, createSignal, type JSX, onCleanup, onMount, type Setter } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { useStickySurface } from '@/components/sticky-surface';
import { navigateDocumentReaderBack } from '@/features/library/document-reader-back';
import {
  centerOutlineItem,
  computeReadingLine,
  isDesktopReaderLayout,
  outlineItemSelector,
  pickActiveSectionAnchor,
  readerScrollBehavior,
} from '@/features/library/document-reader-outline';
import type { DocumentTrail } from '@/state/document-trail';

interface OverlayScrollbarsInstance {
  elements: () => { viewport: HTMLElement | null };
}

export interface DocumentReaderChromeController {
  readonly outlineOpen: () => boolean;
  readonly setOutlineOpen: Setter<boolean>;
  readonly outlineSearchStuck: () => boolean;
  readonly activeAnchor: () => string;
  readonly setActiveAnchor: Setter<string>;
  readonly setChromeElement: (element: HTMLElement) => void;
  readonly setOutline: (element: HTMLElement) => void;
  readonly setOutlineNav: (element: HTMLElement) => void;
  readonly setOutlineScrollbars: (value: OverlayScrollbarsComponentRef) => void;
  readonly setPaper: (element: HTMLElement) => void;
  readonly scrollTo: (anchor: string) => void;
  readonly closeOutline: () => void;
  readonly toggleOutline: () => void;
  readonly bindOutlineScrollbars: (instance: OverlayScrollbarsInstance) => void;
}

export interface UseDocumentReaderChromeOptions {
  readonly initialAnchor?: string | null;
  readonly sectionSelector: string;
  readonly outlineItemAttr: string;
  readonly bodyClosestSelector?: string;
  readonly scrollSpyWhen?: () => boolean;
  readonly onScrollTo?: (anchor: string, element: HTMLElement | null) => void;
}

export function useDocumentReaderChrome(
  options: UseDocumentReaderChromeOptions,
): DocumentReaderChromeController {
  const [outlineOpen, setOutlineOpen] = createSignal(false);
  const [outlineSearchStuck, setOutlineSearchStuck] = createSignal(false);
  const [activeAnchor, setActiveAnchor] = createSignal(options.initialAnchor ?? '');
  const [chromeElement, setChromeElement] = createSignal<HTMLElement | undefined>();
  let outline: HTMLElement | undefined;
  let outlineNav: HTMLElement | undefined;
  let outlineScrollbars: OverlayScrollbarsComponentRef | undefined;
  let paper: HTMLElement | undefined;
  let detachOutlineViewportScroll: (() => void) | undefined;

  useStickySurface(chromeElement);

  const updateOutlineSearchSticky = (): void => {
    const viewport = outlineScrollbars?.osInstance()?.elements().viewport;
    const scrollTop = viewport?.scrollTop ?? outline?.scrollTop ?? 0;
    setOutlineSearchStuck(scrollTop > 1);
  };

  onMount(() => {
    if (isDesktopReaderLayout()) setOutlineOpen(true);
    outline?.addEventListener('scroll', updateOutlineSearchSticky, { passive: true });
    updateOutlineSearchSticky();
    onCleanup(() => {
      detachOutlineViewportScroll?.();
      outline?.removeEventListener('scroll', updateOutlineSearchSticky);
    });
  });

  createEffect(() => {
    const enabled = options.scrollSpyWhen?.() ?? true;
    if (!enabled || !paper) return;
    const body = options.bodyClosestSelector
      ? paper.closest<HTMLElement>(options.bodyClosestSelector)
      : paper.closest<HTMLElement>('.document-page__body');
    const updateActiveSection = (): void => {
      if (!paper) return;
      const sections = Array.from(paper.querySelectorAll<HTMLElement>(options.sectionSelector));
      if (sections.length === 0) return;
      const scroller = paper.scrollHeight > paper.clientHeight + 1 ? paper : (body ?? paper);
      const readingLine = computeReadingLine(scroller.getBoundingClientRect());
      setActiveAnchor(pickActiveSectionAnchor(sections, readingLine));
    };

    paper.addEventListener('scroll', updateActiveSection, { passive: true });
    body?.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);
    queueMicrotask(updateActiveSection);
    onCleanup(() => {
      paper?.removeEventListener('scroll', updateActiveSection);
      body?.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
    });
  });

  createEffect(() => {
    const anchor = activeAnchor();
    if (!anchor || !outlineNav) return;
    queueMicrotask(() => {
      const viewport = outlineScrollbars?.osInstance()?.elements().viewport;
      const item = outlineNav?.querySelector<HTMLElement>(
        outlineItemSelector(options.outlineItemAttr, anchor),
      );
      if (!viewport || !item) return;
      centerOutlineItem(viewport, item);
    });
  });

  const scrollTo = (anchor: string): void => {
    setActiveAnchor(anchor);
    if (!isDesktopReaderLayout()) setOutlineOpen(false);
    requestAnimationFrame(() => {
      const element = document.getElementById(anchor);
      options.onScrollTo?.(anchor, element);
      element?.scrollIntoView({
        behavior: readerScrollBehavior(),
        block: 'start',
      });
    });
  };

  const bindOutlineScrollbars = (instance: OverlayScrollbarsInstance): void => {
    const viewport = instance.elements().viewport;
    viewport?.addEventListener('scroll', updateOutlineSearchSticky, { passive: true });
    updateOutlineSearchSticky();
    detachOutlineViewportScroll = () => {
      viewport?.removeEventListener('scroll', updateOutlineSearchSticky);
    };
  };

  return {
    outlineOpen,
    setOutlineOpen,
    outlineSearchStuck,
    activeAnchor,
    setActiveAnchor,
    setChromeElement,
    setOutline: (element) => {
      outline = element;
    },
    setOutlineNav: (element) => {
      outlineNav = element;
    },
    setOutlineScrollbars: (value) => {
      outlineScrollbars = value;
      detachOutlineViewportScroll?.();
      detachOutlineViewportScroll = undefined;
    },
    setPaper: (element) => {
      paper = element;
    },
    scrollTo,
    closeOutline: () => setOutlineOpen(false),
    toggleOutline: () => setOutlineOpen((open) => !open),
    bindOutlineScrollbars,
  };
}

export interface DocumentReaderChromeShellProps {
  readonly ariaLabel: string;
  readonly class?: string;
  readonly classList?: Record<string, boolean | undefined>;
  readonly chromeClass?: string;
  readonly chromeClassList?: Record<string, boolean | undefined>;
  readonly chrome: DocumentReaderChromeController;
  readonly trail?: DocumentTrail | null;
  readonly onNavigate?: (href: string) => void;
  readonly breadcrumbs: JSX.Element;
  readonly headerSearchSlot?: JSX.Element;
  readonly printButton: JSX.Element;
  readonly bodyError?: JSX.Element;
  readonly bodyPrefix?: JSX.Element;
  readonly loadingBody?: JSX.Element;
  readonly showLayout: boolean;
  readonly outlineSearchSlot?: JSX.Element;
  readonly outlineNav: JSX.Element;
  readonly outlineFooter?: JSX.Element;
  readonly content: JSX.Element;
}

export function DocumentReaderChromeShell(props: DocumentReaderChromeShellProps): JSX.Element {
  const chrome = props.chrome;

  const handleBack = (): void => {
    navigateDocumentReaderBack(props.trail, props.onNavigate);
  };

  return (
    <section
      class={props.class ?? 'document-page page-surface page-grain'}
      classList={props.classList}
      aria-label={props.ariaLabel}
    >
      <header
        ref={chrome.setChromeElement}
        class={props.chromeClass ?? 'document-page__chrome sticky-surface route-sticky-chrome'}
        classList={{
          'document-page__chrome--with-search': Boolean(props.headerSearchSlot),
          ...props.chromeClassList,
        }}
      >
        <NavBack class="document-page__back" aria-label="Назад" onClick={handleBack} />
        <button
          type="button"
          class="document-overlay-outline-toggle"
          aria-label={chrome.outlineOpen() ? 'Скрыть оглавление' : 'Открыть оглавление'}
          aria-expanded={chrome.outlineOpen()}
          onClick={chrome.toggleOutline}
        >
          <AppGlyph name="menu" class="document-overlay-outline-toggle__icon" />
        </button>
        {props.breadcrumbs}
        {props.headerSearchSlot}
        {props.printButton}
      </header>

      <div class="document-page__body document-overlay__body">
        {props.bodyError}
        {props.bodyPrefix}
        {props.showLayout ? (
          <div
            class="document-overlay-layout"
            classList={{ 'document-overlay-layout--outline-hidden': !chrome.outlineOpen() }}
          >
            <button
              type="button"
              class="document-overlay-outline-backdrop"
              classList={{ 'document-overlay-outline-backdrop--open': chrome.outlineOpen() }}
              aria-label="Закрыть оглавление"
              onClick={chrome.closeOutline}
            />
            <aside
              ref={chrome.setOutline}
              class="document-overlay-outline"
              classList={{
                'document-overlay-outline--hidden': !chrome.outlineOpen(),
                'document-overlay-outline--open': chrome.outlineOpen(),
              }}
              aria-hidden={!chrome.outlineOpen()}
            >
              <header class="document-overlay-outline-header">
                <strong>Оглавление</strong>
                <button
                  type="button"
                  class="document-overlay-outline-header__close-button"
                  aria-label="Закрыть оглавление"
                  onClick={chrome.closeOutline}
                >
                  <AppGlyph name="close" class="document-overlay-outline-header__close-icon" />
                </button>
              </header>
              {props.outlineSearchSlot}
              <OverlayScrollbarsComponent
                ref={(value) => {
                  chrome.setOutlineScrollbars(value);
                  const instance = value?.osInstance();
                  if (instance) chrome.bindOutlineScrollbars(instance);
                }}
                class="document-overlay-outline-nav-scroll os-theme-dark"
                options={{ overflow: { x: 'hidden', y: 'scroll' } }}
                defer
              >
                <nav
                  ref={chrome.setOutlineNav}
                  class={`document-overlay-outline-nav${chrome.outlineSearchStuck() ? ' document-overlay-outline-nav--stuck' : ''}`}
                  aria-label="Разделы документа"
                >
                  {props.outlineNav}
                </nav>
              </OverlayScrollbarsComponent>
              {props.outlineFooter}
            </aside>
            {props.content}
          </div>
        ) : (
          props.loadingBody
        )}
      </div>
    </section>
  );
}
