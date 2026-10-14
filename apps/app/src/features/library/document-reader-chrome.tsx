import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-solid';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type Setter,
  Show,
} from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { createFlipAnimator } from '@/components/flip-layout';
import { NavBack } from '@/components/NavBack';
import { useStickySurface } from '@/components/sticky-surface';
import { dismissOpenDocumentFind } from '@/features/library/document-find';
import { navigateDocumentReaderBack } from '@/features/library/document-reader-back';
import {
  isOutlineDrawerOpen,
  OUTLINE_DRAWER_CLOSE_MS,
  OUTLINE_DRAWER_ROOT_CLASS,
  shouldCloseOutlineOnEscape,
} from '@/features/library/document-reader-drawer';
import {
  centerOutlineItem,
  computeReadingLine,
  DESKTOP_READER_LAYOUT_QUERY,
  isDesktopReaderLayout,
  outlineItemSelector,
  pickActiveSectionAnchor,
} from '@/features/library/document-reader-outline';
import {
  type ReaderPageModel,
  readerPageAt,
  readerPageTarget,
} from '@/features/library/document-reader-position';
import { jumpReaderTo } from '@/features/library/document-reader-scroll';
import { ReaderPageBubble } from '@/features/library/ReaderPageBubble';
import { useDocumentOutlineSwipe } from '@/features/library/use-document-outline-swipe';
import type { DocumentTrail } from '@/state/document-trail';
import { holdReaderChrome } from '@/state/reader-chrome-hold';

interface OverlayScrollbarsInstance {
  elements: () => { viewport: HTMLElement | null };
}

export interface DocumentReaderChromeController {
  readonly outlineOpen: () => boolean;
  readonly setOutlineOpen: Setter<boolean>;
  readonly outlineSearchStuck: () => boolean;
  readonly activeAnchor: () => string;
  readonly setActiveAnchor: Setter<string>;
  /**
   * How far the reading line has passed through the active section's own text (0–1). Measured only
   * when the reader asks for it (`measureFraction`): the page bubble turns it into a page number.
   */
  readonly activeFraction: () => number;
  /** The phone contents drawer is open and covers the page. */
  readonly drawerOpen: () => boolean;
  readonly chromeElement: () => HTMLElement | undefined;
  readonly setChromeElement: (element: HTMLElement) => void;
  readonly setOutline: (element: HTMLElement) => void;
  readonly outlineElement: () => HTMLElement | undefined;
  readonly setOutlineNav: (element: HTMLElement) => void;
  readonly setOutlineScrollbars: (value: OverlayScrollbarsComponentRef) => void;
  readonly setPaper: (element: HTMLElement) => void;
  /** `fraction` lands that share of the section's own text below its heading (a page's first line). */
  readonly scrollTo: (anchor: string, options?: { readonly fraction?: number }) => void;
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
  /** Track how far through the active section the reader is (needs sections that nest their children). */
  readonly measureFraction?: boolean;
  readonly onBeforeScrollTo?: (anchor: string) => void;
  readonly onScrollTo?: (anchor: string, element: HTMLElement | null) => void;
}

/** A section aligned by a jump may sit this far below its `scroll-margin-top` and stay active. */
const SECTION_ALIGNMENT_SLACK_PX = 4;

function sectionScrollMargin(section: HTMLElement | undefined): number {
  if (!section) return 0;
  const margin = Number.parseFloat(getComputedStyle(section).scrollMarginTop);
  return Number.isFinite(margin) ? margin : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The part of a section that is its own text: from its top to where its first nested section
 * starts, or to its bottom when it holds none.
 */
function ownTextExtent(
  section: HTMLElement,
  sectionSelector: string,
): { readonly top: number; readonly height: number } {
  const rect = section.getBoundingClientRect();
  const nested = section.querySelector<HTMLElement>(`:scope > ${sectionSelector}`);
  const bottom = nested ? nested.getBoundingClientRect().top : rect.bottom;
  return { top: rect.top, height: Math.max(0, bottom - rect.top) };
}

function isNearScrollEnd(element: HTMLElement, threshold = 32): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function isWindowNearScrollEnd(threshold = 32): boolean {
  const root = document.documentElement;
  return root.scrollHeight - window.scrollY - window.innerHeight <= threshold;
}

export function useDocumentReaderChrome(
  options: UseDocumentReaderChromeOptions,
): DocumentReaderChromeController {
  const [outlineOpen, setOutlineOpen] = createSignal(false);
  const [outlineSearchStuck, setOutlineSearchStuck] = createSignal(false);
  const [activeAnchor, setActiveAnchor] = createSignal(options.initialAnchor ?? '');
  const [activeFraction, setActiveFraction] = createSignal(0);
  const [chromeElement, setChromeElement] = createSignal<HTMLElement | undefined>();
  let outline: HTMLElement | undefined;
  let outlineNav: HTMLElement | undefined;
  let outlineScrollbars: OverlayScrollbarsComponentRef | undefined;
  let paper: HTMLElement | undefined;
  let detachOutlineViewportScroll: (() => void) | undefined;
  let outlineSearchFrame: number | undefined;

  const [desktopLayout, setDesktopLayout] = createSignal(isDesktopReaderLayout());
  const drawerOpen = (): boolean => isOutlineDrawerOpen(outlineOpen(), desktopLayout());
  // The root class parks the bottom navigation while the drawer is up. It is taken off only after
  // the drawer has slid out (200 ms), or the navigation would reappear over the closing drawer.
  let drawerClassTimer: number | undefined;
  createEffect(() => {
    const open = drawerOpen();
    window.clearTimeout(drawerClassTimer);
    drawerClassTimer = undefined;
    const root = document.documentElement;
    if (open) {
      root.classList.add(OUTLINE_DRAWER_ROOT_CLASS);
      return;
    }
    if (!root.classList.contains(OUTLINE_DRAWER_ROOT_CLASS)) return;
    drawerClassTimer = window.setTimeout(() => {
      drawerClassTimer = undefined;
      root.classList.remove(OUTLINE_DRAWER_ROOT_CLASS);
    }, OUTLINE_DRAWER_CLOSE_MS);
  });

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
    // The section path line (`ReaderSectionPath`) and the section jumps start below the chrome.
    const updateHeadingLayout = (): void => {
      root?.style.setProperty(
        '--document-heading-top',
        `${Math.max(0, Math.ceil(element.getBoundingClientRect().bottom))}px`,
      );
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
    const bodyElement = root?.querySelector<HTMLElement>('.document-page__body');
    if (mutations && bodyElement)
      mutations.observe(bodyElement, { childList: true, subtree: true });
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
  const scheduleOutlineSearchSticky = (): void => {
    if (outlineSearchFrame !== undefined) return;
    outlineSearchFrame = requestAnimationFrame(() => {
      outlineSearchFrame = undefined;
      updateOutlineSearchSticky();
    });
  };

  onMount(() => {
    if (isDesktopReaderLayout()) {
      setOutlineOpen(true);
      try {
        const storedWidth = localStorage.getItem('minimed.outline.width');
        const width = storedWidth ? Number.parseInt(storedWidth, 10) : NaN;
        if (Number.isFinite(width) && width >= 200 && width <= 480) {
          chromeElement()
            ?.closest<HTMLElement>('.document-overlay-layout')
            ?.style.setProperty('--outline-column-width', `${width}px`);
        }
      } catch {
        // ignore storage errors
      }
    }
    outline?.addEventListener('scroll', scheduleOutlineSearchSticky, { passive: true });
    scheduleOutlineSearchSticky();

    // Phone drawer: Escape closes it, and it is not left under the bottom navigation.
    const layoutQuery = window.matchMedia(DESKTOP_READER_LAYOUT_QUERY);
    const syncLayout = (): void => {
      setDesktopLayout(layoutQuery.matches);
    };
    layoutQuery.addEventListener('change', syncLayout);
    const closeOnEscape = (event: KeyboardEvent): void => {
      const findOpen = Boolean(chromeElement()?.querySelector('.document-find--open'));
      if (!shouldCloseOutlineOnEscape(event, { drawerOpen: drawerOpen(), findOpen })) return;
      event.preventDefault();
      mutateOutline(() => setOutlineOpen(false));
    };
    window.addEventListener('keydown', closeOnEscape);
    onCleanup(() => {
      layoutQuery.removeEventListener('change', syncLayout);
      window.removeEventListener('keydown', closeOnEscape);
      window.clearTimeout(drawerClassTimer);
      document.documentElement.classList.remove(OUTLINE_DRAWER_ROOT_CLASS);
    });
    onCleanup(() => {
      detachOutlineViewportScroll?.();
      outline?.removeEventListener('scroll', scheduleOutlineSearchSticky);
      if (outlineSearchFrame !== undefined) cancelAnimationFrame(outlineSearchFrame);
    });
  });

  createEffect(() => {
    const enabled = options.scrollSpyWhen?.() ?? true;
    if (!enabled || !paper) return;
    const body = options.bodyClosestSelector
      ? paper.closest<HTMLElement>(options.bodyClosestSelector)
      : paper.closest<HTMLElement>('.document-page__body');
    let sections: readonly HTMLElement[] = [];
    const refreshSections = (): void => {
      sections = Array.from(paper?.querySelectorAll<HTMLElement>(options.sectionSelector) ?? []);
    };
    refreshSections();
    const updateActiveSection = (): void => {
      if (!paper) return;
      if (sections.length === 0) return;
      const paperScrolls = paper.scrollHeight > paper.clientHeight + 1;
      const bodyScrolls = Boolean(body && body.scrollHeight > body.clientHeight + 1);
      const nearEnd = paperScrolls
        ? isNearScrollEnd(paper)
        : bodyScrolls && body
          ? isNearScrollEnd(body)
          : isWindowNearScrollEnd();
      const scrollerRect = paperScrolls
        ? paper.getBoundingClientRect()
        : bodyScrolls && body
          ? body.getBoundingClientRect()
          : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const readingLine = computeReadingLine(
        scrollerRect,
        sectionScrollMargin(sections[0]) + SECTION_ALIGNMENT_SLACK_PX,
      );
      const nextAnchor = nearEnd
        ? (sections.at(-1)?.id ?? sections[0]?.id ?? '')
        : pickActiveSectionAnchor(sections, readingLine);
      if (nextAnchor !== activeAnchor()) setActiveAnchor(nextAnchor);
      if (options.measureFraction) {
        const section = nextAnchor ? document.getElementById(nextAnchor) : null;
        if (section) {
          // At the very end the reading line is the bottom of the window: the last section's text
          // may end above it, and that is the end of the last page.
          const extent = ownTextExtent(section, options.sectionSelector);
          const line = nearEnd ? scrollerRect.bottom : readingLine;
          const fraction = extent.height > 0 ? clamp01((line - extent.top) / extent.height) : 0;
          if (Math.abs(fraction - activeFraction()) >= 0.002) setActiveFraction(fraction);
        }
      }
    };

    let activeFrame: number | undefined;
    const scheduleActiveSection = (): void => {
      if (activeFrame !== undefined) return;
      activeFrame = requestAnimationFrame(() => {
        activeFrame = undefined;
        updateActiveSection();
      });
    };

    paper.addEventListener('scroll', scheduleActiveSection, { passive: true });
    body?.addEventListener('scroll', scheduleActiveSection, { passive: true });
    window.addEventListener('scroll', scheduleActiveSection, { passive: true });
    window.addEventListener('resize', scheduleActiveSection);
    const sectionMutations = new MutationObserver(() => {
      refreshSections();
      scheduleActiveSection();
    });
    sectionMutations.observe(paper, { childList: true, subtree: true });
    queueMicrotask(scheduleActiveSection);
    onCleanup(() => {
      paper?.removeEventListener('scroll', scheduleActiveSection);
      body?.removeEventListener('scroll', scheduleActiveSection);
      window.removeEventListener('scroll', scheduleActiveSection);
      window.removeEventListener('resize', scheduleActiveSection);
      if (activeFrame !== undefined) cancelAnimationFrame(activeFrame);
      sectionMutations.disconnect();
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

  const scrollTo = (anchor: string, jump?: { readonly fraction?: number }): void => {
    const fraction = clamp01(jump?.fraction ?? 0);
    setActiveAnchor(anchor);
    setActiveFraction(fraction);
    if (!isDesktopReaderLayout()) {
      mutateOutline(() => setOutlineOpen(false));
    }
    // Everything up to the target mounts first (the host renders sections in idle batches); the
    // jump then corrects itself until the target stands still below the sticky headings.
    options.onBeforeScrollTo?.(anchor);
    jumpReaderTo(() => document.getElementById(anchor), {
      align: 'start',
      // A page that begins inside a section lands that share of the section's own text below its
      // heading; the size is read every frame, as it settles while the sections around it render.
      offset: () => {
        const element = fraction > 0 ? document.getElementById(anchor) : null;
        return element ? fraction * ownTextExtent(element, options.sectionSelector).height : 0;
      },
      onSettled: (element) => options.onScrollTo?.(anchor, element),
    });
  };

  const bindOutlineScrollbars = (instance: OverlayScrollbarsInstance): void => {
    const viewport = instance.elements().viewport;
    viewport?.addEventListener('scroll', scheduleOutlineSearchSticky, { passive: true });
    scheduleOutlineSearchSticky();
    detachOutlineViewportScroll = () => {
      viewport?.removeEventListener('scroll', scheduleOutlineSearchSticky);
    };
  };

  // Outline open/close mutates the grid instantly and slides the paper via
  // FLIP, so text reflows once instead of animating every frame.
  const mutateOutline = (mutate: () => void): void => {
    const root =
      paper?.closest<HTMLElement>('.document-overlay-layout') ??
      chromeElement()?.closest<HTMLElement>('.document-overlay-layout');
    if (!root) {
      mutate();
      return;
    }
    createFlipAnimator(root, { selector: '.document-overlay-paper', durationMs: 200 })(mutate);
  };

  return {
    outlineOpen,
    setOutlineOpen,
    outlineSearchStuck,
    activeAnchor,
    setActiveAnchor,
    activeFraction,
    drawerOpen,
    chromeElement,
    setChromeElement,
    setOutline: (element) => {
      outline = element;
    },
    outlineElement: () => outline,
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
    closeOutline: () => mutateOutline(() => setOutlineOpen(false)),
    toggleOutline: () =>
      mutateOutline(() => {
        setOutlineOpen((open) => !open);
      }),
    bindOutlineScrollbars,
  };
}

export interface DocumentReaderChromeShellProps {
  readonly ariaLabel: string;
  readonly class?: string;
  readonly classList?: Record<string, boolean | undefined>;
  readonly chromeClass?: string;
  readonly chromeClassList?: Record<string, boolean | undefined>;
  readonly layoutClassList?: Record<string, boolean | undefined>;
  readonly bodyClassList?: Record<string, boolean | undefined>;
  readonly chrome: DocumentReaderChromeController;
  readonly trail?: DocumentTrail | null;
  readonly onNavigate?: (href: string) => void;
  readonly onBack?: () => void;
  /** Accessible name of the back control; defaults to «Назад». */
  readonly backLabel?: string;
  /** Return true to consume the back press (e.g. exit an inline mode first). */
  readonly onBackIntercept?: () => boolean;
  readonly breadcrumbs: JSX.Element;
  readonly headerSearchSlot?: JSX.Element;
  readonly searchOpen?: () => boolean;
  readonly printButton?: JSX.Element;
  readonly bodyError?: JSX.Element;
  readonly bodyPrefix?: JSX.Element;
  readonly loadingBody?: JSX.Element;
  readonly showLayout: boolean;
  readonly outlineEnabled?: boolean;
  /**
   * The pages of the document (`document-reader-position.ts`): they give the page bubble («12 / 94»)
   * its numbers and its jump targets. Left out, or `null` for a document of one page, the reader
   * shows no bubble.
   */
  readonly pages?: () => ReaderPageModel | null;
  readonly outlineSearchSlot?: JSX.Element;
  /** Heading of the side panel; «Оглавление» unless the panel lists something else (PDF pages). */
  readonly outlineTitle?: string;
  readonly outlineNav: JSX.Element;
  readonly outlineFooter?: JSX.Element;
  readonly content: JSX.Element;
}

export function DocumentReaderChromeShell(props: DocumentReaderChromeShellProps): JSX.Element {
  const chrome = props.chrome;
  const searchOpen = (): boolean => props.searchOpen?.() ?? false;
  const outlineSwipe = useDocumentOutlineSwipe({
    outlineOpen: chrome.outlineOpen,
    openOutline: () => chrome.setOutlineOpen(true),
    closeOutline: chrome.closeOutline,
  });

  const pageModel = (): ReaderPageModel | null => props.pages?.() ?? null;
  const currentPage = createMemo(() => {
    const model = pageModel();
    return model ? readerPageAt(model, chrome.activeAnchor(), chrome.activeFraction()) : 1;
  });
  /** A jump the reader makes by itself keeps the controls visible, like find and «go to page». */
  const goToPage = (page: number): void => {
    const model = pageModel();
    const target = model ? readerPageTarget(model, page) : null;
    if (!target) return;
    holdReaderChrome();
    chrome.scrollTo(target.anchor, { fraction: target.fraction });
  };

  const handleBack = (): void => {
    const header = chrome.chromeElement();
    if (header && dismissOpenDocumentFind(header)) return;
    if (props.onBackIntercept?.()) return;
    if (props.onBack) {
      props.onBack();
      return;
    }
    navigateDocumentReaderBack(props.trail, props.onNavigate);
  };

  return (
    <section
      class={props.class ?? 'document-page page-surface page-grain'}
      classList={props.classList}
      aria-label={props.ariaLabel}
    >
      <div
        ref={outlineSwipe.ref}
        class="document-overlay-layout"
        classList={{
          ...props.layoutClassList,
          'document-overlay-layout--outline-hidden':
            props.outlineEnabled === false || !chrome.outlineOpen(),
          'document-overlay-layout--outline-disabled': props.outlineEnabled === false,
        }}
      >
        <Show when={props.outlineEnabled !== false}>
          <button
            type="button"
            class="document-overlay-outline-backdrop"
            classList={{ 'document-overlay-outline-backdrop--open': chrome.outlineOpen() }}
            aria-label="Закрыть оглавление"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              chrome.closeOutline();
            }}
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
            <button
              type="button"
              class="document-overlay-outline-resize"
              aria-label="Изменить ширину оглавления"
              onPointerDown={(pointerDown) => {
                const handle = pointerDown.currentTarget;
                const layout = handle.closest<HTMLElement>('.document-overlay-layout');
                if (!layout) return;
                pointerDown.preventDefault();
                handle.setPointerCapture(pointerDown.pointerId);
                const startX = pointerDown.clientX;
                const outlineElement = layout.querySelector<HTMLElement>(
                  '.document-overlay-outline',
                );
                const startWidth = Math.round(outlineElement?.getBoundingClientRect().width ?? 220);
                let frame: number | undefined;
                let width = startWidth;
                const applyWidth = (): void => {
                  frame = undefined;
                  layout.style.setProperty('--outline-column-width', `${width}px`);
                };
                const onMove = (move: PointerEvent): void => {
                  width = Math.min(480, Math.max(200, startWidth + move.clientX - startX));
                  if (frame === undefined) frame = requestAnimationFrame(applyWidth);
                };
                const stop = (): void => {
                  handle.removeEventListener('pointermove', onMove);
                  handle.removeEventListener('pointerup', stop);
                  handle.removeEventListener('pointercancel', stop);
                  if (frame !== undefined) cancelAnimationFrame(frame);
                  layout.classList.remove('document-overlay-layout--resizing');
                  try {
                    localStorage.setItem('minimed.outline.width', String(width));
                  } catch {
                    // storage unavailable — width applies until reload
                  }
                };
                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', stop);
                handle.addEventListener('pointercancel', stop);
                layout.classList.add('document-overlay-layout--resizing');
              }}
            />
            <header class="document-overlay-outline-header">
              <strong>{props.outlineTitle ?? 'Оглавление'}</strong>
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
        </Show>
        <div class="document-page__main">
          <header
            ref={chrome.setChromeElement}
            class={
              props.chromeClass ??
              'document-page__chrome sticky-surface route-sticky-chrome route-sticky-chrome--opaque'
            }
            classList={{
              'document-page__chrome--with-search': Boolean(props.headerSearchSlot),
              'document-page__chrome--with-print': Boolean(props.printButton),
              ...props.chromeClassList,
            }}
          >
            <NavBack
              class="document-page__back"
              aria-label={searchOpen() ? 'Закрыть поиск' : (props.backLabel ?? 'Назад')}
              onClick={handleBack}
              icon={
                <AppGlyph
                  name={searchOpen() ? 'close' : 'arrow-left'}
                  class="document-page__back-icon"
                />
              }
            />
            <Show when={props.outlineEnabled !== false}>
              <button
                type="button"
                class="document-overlay-outline-toggle"
                aria-label={chrome.outlineOpen() ? 'Скрыть оглавление' : 'Открыть оглавление'}
                aria-expanded={chrome.outlineOpen()}
                disabled={!props.showLayout}
                onClick={chrome.toggleOutline}
              >
                <AppGlyph name="menu" class="document-overlay-outline-toggle__icon" />
              </button>
            </Show>
            <div class="document-page__trail">{props.breadcrumbs}</div>
            {props.headerSearchSlot}
            <Show when={props.printButton}>{props.printButton}</Show>
          </header>
          <div class="document-page__body document-overlay__body" classList={props.bodyClassList}>
            {props.bodyError}
            {props.bodyPrefix}
            <Show when={props.showLayout} fallback={props.loadingBody}>
              {props.content}
            </Show>
          </div>
          <Show when={props.showLayout ? pageModel() : null}>
            {(model) => (
              <ReaderPageBubble
                page={currentPage()}
                total={model().total}
                hidden={chrome.drawerOpen()}
                onGo={goToPage}
              />
            )}
          </Show>
        </div>
      </div>
    </section>
  );
}
