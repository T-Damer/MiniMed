import { Breadcrumbs } from '@kobalte/core/breadcrumbs';
import { For, type JSX, Show } from 'solid-js';

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
  /** No crumb is the current page (the page heading names it): every crumb with a target links. */
  readonly allLinks?: boolean;
}

/** The current page's title: one line cut with an ellipsis; the full text is the tooltip. */
function BreadcrumbCurrentLabel(props: { readonly text: string }): JSX.Element {
  return (
    <span class="document-crumbs__current-label" title={props.text}>
      {props.text}
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
            const isCurrent = (): boolean =>
              (!props.allLinks && index() === lastIndex()) || !item.href;
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
