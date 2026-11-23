import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import {
  pickStuckHeadingIndex,
  sameTitlePath,
  sectionPathLabel,
  sectionTitlePath,
} from '@/features/library/document-reader-section-path';
import { ReaderPageBubble } from '@/features/library/ReaderPageBubble';
import { type ReaderPageHost, readerPageHostOf } from '@/features/library/reader-page-host';

import './reader-section-path.css';

const TITLE_SELECTOR = '.document-overlay-section__title';
/** Without a stuck heading the line still appears once the reader has left the top of the text. */
const PAGE_LINE_SCROLL_PX = 160;

/**
 * One compact line under the reader chrome that names where the reader is, as the whole section
 * path («3. Лечение › 3.1 … › 3.1.4 …») instead of one sticky heading per level. It takes no room
 * in the text (the headings scroll as ordinary text) and appears once the first heading has gone
 * under it. Place it inside the paper, before the sections.
 *
 * The line also holds the reader's page counter («12 / 94», tap to jump), so the counter sits on
 * an opaque bar of the chrome instead of floating over the text.
 */
export function ReaderSectionPath(): JSX.Element {
  const [path, setPath] = createSignal<readonly string[]>([], { equals: sameTitlePath });
  const [shown, setShown] = createSignal(false);
  let pageHost: ReaderPageHost | undefined;
  const [hostsPages, setHostsPages] = createSignal(false);
  let anchor: HTMLDivElement | undefined;
  let line: HTMLDivElement | undefined;

  onMount(() => {
    const paper = anchor?.closest<HTMLElement>('.document-overlay-paper');
    if (!anchor || !line || !paper) return;
    pageHost = readerPageHostOf(anchor);
    if (pageHost) {
      const release = pageHost.claim();
      setHostsPages(true);
      onCleanup(release);
    }
    const stickyAnchor = anchor;
    const stickyLine = line;
    let headings: readonly HTMLElement[] = [];
    // The list and the sticky offset are read again only when the page or the chrome changed, in
    // the next frame, not on every mutation or scroll (owner 2026-11-06: the reader lagged).
    let headingsStale = true;
    let stickyTop: number | undefined;
    let lastIndex = -1;
    const update = (): void => {
      if (headingsStale) {
        headings = Array.from(paper.querySelectorAll<HTMLElement>(TITLE_SELECTOR));
        headingsStale = false;
        lastIndex = -1;
      }
      stickyTop ??= Number.parseFloat(getComputedStyle(stickyAnchor).top);
      const anchorTop = stickyAnchor.getBoundingClientRect().top;
      // Before the line has reached its place it is still in the flow, above the first heading.
      const stuck = anchorTop <= stickyTop + 1;
      const index = stuck
        ? pickStuckHeadingIndex(headings, anchorTop + stickyLine.offsetHeight - 1, lastIndex)
        : -1;
      lastIndex = index;
      const heading = index < 0 ? undefined : headings[index];
      setShown(
        heading !== undefined ||
          (pageHost !== undefined && pageHost.total() > 0 && window.scrollY > PAGE_LINE_SCROLL_PX),
      );
      // The last path stays while the line fades out.
      if (heading) setPath(sectionTitlePath(heading));
    };
    let frame: number | undefined;
    const SECTION_PATH_INTERVAL_MS = 100;
    let task: number | undefined;
    let timer: number | undefined;
    let measuredAt = Number.NEGATIVE_INFINITY;
    const measureAfterPaint = (): void => {
      if (frame !== undefined || task !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        task = window.setTimeout(() => {
          task = undefined;
          measuredAt = performance.now();
          update();
        }, 0);
      });
    };
    const schedule = (): void => {
      if (frame !== undefined || task !== undefined || timer !== undefined) return;
      const wait = SECTION_PATH_INTERVAL_MS - (performance.now() - measuredAt);
      if (wait <= 0) {
        measureAfterPaint();
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        measureAfterPaint();
      }, wait);
    };
    const remeasure = (): void => {
      stickyTop = undefined;
      schedule();
    };
    const mutations = new MutationObserver(() => {
      headingsStale = true;
      schedule();
    });
    mutations.observe(paper, { childList: true, subtree: true });
    // A section the browser starts or stops rendering changes which headings can be measured.
    paper.addEventListener('contentvisibilityautostatechange', schedule, true);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', remeasure);
    // The line moves to the screen edge when the chrome hides: measure again once it has settled.
    stickyAnchor.addEventListener('transitionend', remeasure);
    let wasChromeHidden = document.documentElement.classList.contains('app-chrome-hidden');
    const rootClass = new MutationObserver(() => {
      const hidden = document.documentElement.classList.contains('app-chrome-hidden');
      if (hidden === wasChromeHidden) return;
      wasChromeHidden = hidden;
      remeasure();
    });
    rootClass.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    schedule();
    onCleanup(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (task !== undefined) window.clearTimeout(task);
      if (timer !== undefined) window.clearTimeout(timer);
      mutations.disconnect();
      paper.removeEventListener('contentvisibilityautostatechange', schedule, true);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', remeasure);
      stickyAnchor.removeEventListener('transitionend', remeasure);
      rootClass.disconnect();
    });
  });

  return (
    <div ref={anchor} class="reader-section-path">
      <div
        ref={line}
        class="reader-section-path__line"
        classList={{ 'reader-section-path__line--shown': shown() }}
      >
        <span class="reader-section-path__trail" aria-hidden="true">
          <For each={path()}>
            {(title, index) => (
              <>
                <Show when={index() > 0}>
                  <span class="reader-section-path__separator">›</span>
                </Show>
                <span
                  class="reader-section-path__title"
                  classList={{
                    'reader-section-path__title--current': index() === path().length - 1,
                  }}
                >
                  {index() === path().length - 1 ? title : sectionPathLabel(title)}
                </span>
              </>
            )}
          </For>
        </span>
        <Show when={hostsPages() && pageHost && pageHost.total() > 0 ? pageHost : undefined}>
          {(host) => (
            <ReaderPageBubble
              inline
              page={host().page()}
              total={host().total()}
              hidden={host().hidden()}
              onGo={host().go}
            />
          )}
        </Show>
      </div>
    </div>
  );
}
