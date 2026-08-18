import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-solid';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type Setter,
  Show,
} from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { NavBack } from '@/components/NavBack';
import { useStickySurface } from '@/components/sticky-surface';
import { dismissOpenDocumentFind } from '@/features/library/document-find';
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
  readonly chromeElement: () => HTMLElement | undefined;
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

  createEffect(() => {
    const element = chromeElement();
    if (!element) return;
    const root = element.closest<HTMLElement>('.document-page');
    const applyHeight = (): void => {
      const height = `${element.getBoundingClientRect().height}px`;
      element.style.setProperty('--document-chrome-height', height);
      root?.style.setProperty('--document-chrome-height', height);
    };
    const updateHeadingLayout = (): void => {
      if (!root) return;
      let top = Math.max(0, Math.ceil(element.getBoundingClientRect().bottom));
      for (let level = 1; level <= 6; level += 1) {
        const levelName = `h${level}`;
        root.style.setProperty(`--document-heading-${levelName}-top`, `${top}px`);
        const heading = root.querySelector<HTMLElement>(
          `.document-overlay-section__title--${levelName}`,
        );
        const height = heading?.offsetHeight ?? 0;
        root.style.setProperty(`--document-heading-${levelName}-height`, `${height}px`);
        top += height;
      }
    };
    let frame: number | undefined;
    const schedule = (): void => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        applyHeight();
        updateHeadingLayout();
      });
    };
    applyHeight();
    updateHeadingLayout();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    const mutations = root ? new MutationObserver(schedule) : undefined;
    if (mutations && root) mutations.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    onCleanup(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      mutations?.disconnect();
      window.removeEventListener('resize', schedule);
    });
  });

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
      const paperScrolls = paper.scrollHeight > paper.clientHeight + 1;
      const bodyScrolls = Boolean(body && body.scrollHeight > body.clientHeight + 1);
      const scrollerRect = paperScrolls
        ? paper.getBoundingClientRect()
        : bodyScrolls && body
          ? body.getBoundingClientRect()
          : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const readingLine = computeReadingLine(scrollerRect);
      setActiveAnchor(pickActiveSectionAnchor(sections, readingLine));
    };

    paper.addEventListener('scroll', updateActiveSection, { passive: true });
    body?.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);
    queueMicrotask(updateActiveSection);
    onCleanup(() => {
      paper?.removeEventListener('scroll', updateActiveSection);
      body?.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('scroll', updateActiveSection);
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
    chromeElement,
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
  readonly searchOpen?: () => boolean;
  readonly printButton?: JSX.Element;
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
  const searchOpen = (): boolean => props.searchOpen?.() ?? false;

  const handleBack = (): void => {
    const header = chrome.chromeElement();
    if (header && dismissOpenDocumentFind(header)) return;
    navigateDocumentReaderBack(props.trail, props.onNavigate);
  };

  return (
    <section
      class={props.class ?? 'document-page page-surface page-grain'}
      classList={props.classList}
      aria-label={props.ariaLabel}
    >
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
          <div class="document-page__main">
            <header
              ref={chrome.setChromeElement}
              class={
                props.chromeClass ?? 'document-page__chrome sticky-surface route-sticky-chrome'
              }
              classList={{
                'document-page__chrome--with-search': Boolean(props.headerSearchSlot),
                ...props.chromeClassList,
              }}
            >
              <NavBack
                class="document-page__back"
                aria-label={searchOpen() ? 'Закрыть поиск' : 'Назад'}
                onClick={handleBack}
                icon={
                  <AppGlyph
                    name={searchOpen() ? 'close' : 'arrow-left'}
                    class="document-page__back-icon"
                  />
                }
              />
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
              <Show when={props.printButton}>{props.printButton}</Show>
            </header>
            <div class="document-page__body document-overlay__body">
              {props.bodyError}
              {props.bodyPrefix}
              {props.content}
            </div>
          </div>
        </div>
      ) : (
        <>
          <header
            ref={chrome.setChromeElement}
            class={props.chromeClass ?? 'document-page__chrome sticky-surface route-sticky-chrome'}
            classList={{
              'document-page__chrome--with-search': Boolean(props.headerSearchSlot),
              ...props.chromeClassList,
            }}
          >
            <NavBack
              class="document-page__back"
              aria-label={searchOpen() ? 'Закрыть поиск' : 'Назад'}
              onClick={handleBack}
              icon={
                <AppGlyph
                  name={searchOpen() ? 'close' : 'arrow-left'}
                  class="document-page__back-icon"
                />
              }
            />
            {props.breadcrumbs}
          </header>
          <div class="document-page__body document-overlay__body">
            {props.bodyError}
            {props.loadingBody}
          </div>
        </>
      )}
    </section>
  );
}
