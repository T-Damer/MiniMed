import { Breadcrumbs } from '@kobalte/core/breadcrumbs';
import { For, type JSX, Show } from 'solid-js';

export interface AppBreadcrumbItem {
  readonly label: string;
  readonly href?: string;
}

interface AppBreadcrumbsProps {
  readonly items: readonly AppBreadcrumbItem[];
  readonly onNavigate?: (href: string) => void;
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
            return (
              <li class="document-crumbs__item">
                <Breadcrumbs.Link
                  class="document-crumbs__link"
                  classList={{ 'document-crumbs__current': isCurrent() }}
                  current={isCurrent()}
                  {...(!isCurrent() && item.href ? { href: item.href } : {})}
                  {...(!isCurrent() && item.href && props.onNavigate
                    ? {
                        onClick: (event: MouseEvent) => openHref(event, item.href as string),
                      }
                    : {})}
                >
                  {item.label}
                </Breadcrumbs.Link>
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
