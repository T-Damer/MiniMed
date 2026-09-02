import { type JSX, Show } from 'solid-js';

export interface PageProps {
  readonly class?: string;
  readonly navigation?: JSX.Element;
  readonly navigationClass?: string;
  readonly breadcrumbs?: JSX.Element;
  readonly icon?: JSX.Element;
  readonly title?: JSX.Element;
  readonly description?: JSX.Element;
  readonly actions?: JSX.Element;
}

export function Page(props: PageProps): JSX.Element {
  const className = (base: string, extra?: string): string => (extra ? `${base} ${extra}` : base);

  return (
    <header class={`page ${props.class ?? ''}`}>
      <div class="page__above-header">
        <Show when={props.navigation !== undefined}>
          <div class={className('page__left-actions', props.navigationClass)}>
            {props.navigation}
          </div>
        </Show>
        <Show when={props.breadcrumbs !== undefined}>
          <div class="page__breadcrumbs">{props.breadcrumbs}</div>
        </Show>
        <Show when={props.actions !== undefined}>
          <div class="page__right-actions">{props.actions}</div>
        </Show>
      </div>
      <Show
        when={
          props.icon !== undefined || props.title !== undefined || props.description !== undefined
        }
      >
        <div class="page__header">
          <Show when={props.icon !== undefined || props.title !== undefined}>
            <div class="page__title-row">
              <Show when={props.icon !== undefined}>
                <div class="page__icon">{props.icon}</div>
              </Show>
              <Show when={props.title !== undefined}>
                <div class="page__title">{props.title}</div>
              </Show>
            </div>
          </Show>
          <Show when={props.description !== undefined}>
            <p class="page__description">{props.description}</p>
          </Show>
        </div>
      </Show>
    </header>
  );
}
