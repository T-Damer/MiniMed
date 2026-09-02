import { Breadcrumbs } from '@kobalte/core/breadcrumbs';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

export interface AppBreadcrumbItem {
  readonly label: string;
  readonly href?: string;
  readonly currentContent?: JSX.Element;
  readonly onCurrentClick?: () => void;
  readonly currentAriaLabel?: string;
}

interface AppBreadcrumbsProps {
  readonly items: readonly AppBreadcrumbItem[];
  readonly onNavigate?: (href: string) => void;
}

function BreadcrumbCurrentLabel(props: { readonly text: string }): JSX.Element {
  const [overflowDistance, setOverflowDistance] = createSignal(0);
  let label: HTMLElement | undefined;
  let text: HTMLSpanElement | undefined;

  onMount(() => {
    if (!label || !text) return;
    const measure = (): void => {
      setOverflowDistance(Math.max(0, Math.ceil(text.scrollWidth - label.clientWidth)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    observer.observe(text);
    const frame = requestAnimationFrame(measure);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    });
  });

  return (
    <span class="document-crumbs__current-label" title={props.text} ref={label}>
      <span
        class="document-crumbs__current-text"
        classList={{ 'document-crumbs__current-text--marquee': overflowDistance() > 1 }}
        style={{ '--document-crumbs-current-shift': `${String(overflowDistance())}px` }}
        ref={text}
      >
        {props.text}
      </span>
    </span>
  );
}

export function AppBreadcrumbs(props: AppBreadcrumbsProps): JSX.Element {
  const lastIndex = (): number => props.items.length - 1;

  const openHref = (event: MouseEvent, href: string): void => {
    if (!props.onNavigate) return;
    event.preventDefault();
    props.onNavigate(href);
  };

  return (
    <Breadcrumbs
      class="document-crumbs"
      translations={{ breadcrumbs: 'Навигация по разделам' }}
      separator="/"
    >
      <ol class="document-crumbs__list">
        <For each={props.items}>
          {(item, index) => {
            const isCurrent = (): boolean => index() === lastIndex() || !item.href;
            const currentAction = (): boolean => isCurrent() && Boolean(item.onCurrentClick);
            return (
              <li class="document-crumbs__item">
                <Show
                  when={isCurrent() ? item.currentContent : undefined}
                  fallback={
                    <Show
                      when={currentAction()}
                      fallback={
                        <Breadcrumbs.Link
                          class="document-crumbs__link"
                          classList={{ 'document-crumbs__current': isCurrent() }}
                          current={isCurrent()}
                          {...(!isCurrent() && item.href ? { href: item.href } : {})}
                          {...(!isCurrent() && item.href && props.onNavigate
                            ? {
                                onClick: (event: MouseEvent) =>
                                  openHref(event, item.href as string),
                              }
                            : {})}
                        >
                          {isCurrent() ? <BreadcrumbCurrentLabel text={item.label} /> : item.label}
                        </Breadcrumbs.Link>
                      }
                    >
                      <button
                        class="document-crumbs__link document-crumbs__current document-crumbs__current--action"
                        type="button"
                        aria-current="page"
                        aria-label={item.currentAriaLabel ?? item.label}
                        onClick={() => item.onCurrentClick?.()}
                      >
                        <BreadcrumbCurrentLabel text={item.label} />
                      </button>
                    </Show>
                  }
                >
                  {(content) => (
                    <span
                      class="document-crumbs__current document-crumbs__current--editor"
                      aria-current="page"
                    >
                      {content()}
                    </span>
                  )}
                </Show>
                <Show when={index() < lastIndex()}>
                  <Breadcrumbs.Separator class="document-crumbs__separator" />
                </Show>
              </li>
            );
          }}
        </For>
      </ol>
    </Breadcrumbs>
  );
}
