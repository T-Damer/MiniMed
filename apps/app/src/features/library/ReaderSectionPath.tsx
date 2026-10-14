import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import {
  pickStuckHeadingIndex,
  sameTitlePath,
  sectionPathLabel,
  sectionTitlePath,
} from '@/features/library/document-reader-section-path';
import { ReaderPageBubble } from '@/features/library/ReaderPageBubble';
import { useReaderPageHost } from '@/features/library/reader-page-host';

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
  const pageHost = useReaderPageHost();
  const [hostsPages, setHostsPages] = createSignal(false);
  let anchor: HTMLDivElement | undefined;
  let line: HTMLDivElement | undefined;

  onMount(() => {
    const paper = anchor?.closest<HTMLElement>('.document-overlay-paper');
    if (!anchor || !line || !paper) return;
    if (pageHost) {
      const release = pageHost.claim();
      setHostsPages(true);
      onCleanup(release);
    }
    const stickyAnchor = anchor;
    const stickyLine = line;
    let headings: readonly HTMLElement[] = [];
    const refresh = (): void => {
      headings = Array.from(paper.querySelectorAll<HTMLElement>(TITLE_SELECTOR));
    };
    refresh();
    const update = (): void => {
      const anchorTop = stickyAnchor.getBoundingClientRect().top;
      // Before the line has reached its place it is still in the flow, above the first heading.
      const stuck = anchorTop <= Number.parseFloat(getComputedStyle(stickyAnchor).top) + 1;
      const index = stuck
        ? pickStuckHeadingIndex(headings, anchorTop + stickyLine.offsetHeight - 1)
        : -1;
      const heading = index < 0 ? undefined : headings[index];
      setShown(
        heading !== undefined ||
          (pageHost !== undefined && pageHost.total() > 0 && window.scrollY > PAGE_LINE_SCROLL_PX),
      );
      // The last path stays while the line fades out.
      if (heading) setPath(sectionTitlePath(heading));
    };
    let frame: number | undefined;
    const schedule = (): void => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        update();
      });
    };
    const mutations = new MutationObserver(() => {
      refresh();
      schedule();
    });
    mutations.observe(paper, { childList: true, subtree: true });
    // A section the browser starts or stops rendering changes which headings can be measured.
    paper.addEventListener('contentvisibilityautostatechange', schedule, true);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // The line moves to the screen edge when the chrome hides: measure again once it has settled.
    stickyAnchor.addEventListener('transitionend', schedule);
    schedule();
    onCleanup(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      mutations.disconnect();
      paper.removeEventListener('contentvisibilityautostatechange', schedule, true);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      stickyAnchor.removeEventListener('transitionend', schedule);
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
