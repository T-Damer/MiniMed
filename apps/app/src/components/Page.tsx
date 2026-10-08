import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SheetPopover } from '@/components/SheetPopover';

export interface PageProps {
  readonly class?: string;
  readonly navigation?: JSX.Element;
  readonly navigationClass?: string;
  readonly breadcrumbs?: JSX.Element;
  readonly icon?: JSX.Element;
  readonly title?: JSX.Element;
  readonly description?: JSX.Element;
  readonly actions?: JSX.Element;
  /** «Как это работает» and other explanations: a round «?» in the header opens it. */
  readonly help?: JSX.Element;
  /** Heading of the help panel; «Как это работает» by default. */
  readonly helpTitle?: string;
}

/**
 * Route header. With a back button or header tools the title sits in the same row between them
 * (AGENTS.md «Interface rules»); the description is one quiet line under that row.
 */
export function Page(props: PageProps): JSX.Element {
  const className = (base: string, extra?: string): string => (extra ? `${base} ${extra}` : base);
  const [helpOpen, setHelpOpen] = createSignal(false);
  const inline = (): boolean =>
    props.title !== undefined &&
    props.breadcrumbs === undefined &&
    (props.navigation !== undefined || props.actions !== undefined || props.help !== undefined);
  const helpTitle = (): string => props.helpTitle ?? 'Как это работает';

  const titleRow = (): JSX.Element => (
    <div class="page__title-row" classList={{ 'page__title-row--inline': inline() }}>
      <Show when={props.icon !== undefined && !inline()}>
        <div class="page__icon">{props.icon}</div>
      </Show>
      <div class="page__title">{props.title}</div>
    </div>
  );

  return (
    <header class={`page ${props.class ?? ''}`} classList={{ 'page--inline': inline() }}>
      <Show
        when={
          props.navigation !== undefined ||
          props.breadcrumbs !== undefined ||
          props.actions !== undefined ||
          props.help !== undefined
        }
      >
        <div class="page__above-header">
          <Show when={props.navigation !== undefined}>
            <div class={className('page__left-actions', props.navigationClass)}>
              {props.navigation}
            </div>
          </Show>
          <Show when={props.breadcrumbs !== undefined}>
            <div class="page__breadcrumbs">{props.breadcrumbs}</div>
          </Show>
          <Show when={inline()}>{titleRow()}</Show>
          <Show when={props.actions !== undefined || props.help !== undefined}>
            <div class="page__right-actions">
              <Show when={props.help !== undefined}>
                <SheetPopover
                  open={helpOpen()}
                  onOpenChange={setHelpOpen}
                  title={helpTitle()}
                  triggerClass="page__help-button"
                  triggerLabel={helpTitle()}
                  triggerTitle={helpTitle()}
                  trigger={<AppGlyph name="question" class="page__help-icon" />}
                  contentClass="page__help-panel"
                  placement="bottom-end"
                >
                  <div class="page__help-body">{props.help}</div>
                </SheetPopover>
              </Show>
              {props.actions}
            </div>
          </Show>
        </div>
      </Show>
      <Show
        when={
          (!inline() && (props.icon !== undefined || props.title !== undefined)) ||
          props.description !== undefined
        }
      >
        <div class="page__header">
          <Show when={!inline() && (props.icon !== undefined || props.title !== undefined)}>
            {titleRow()}
          </Show>
          <Show when={props.description !== undefined}>
            <p class="page__description" classList={{ 'page__description--inline': inline() }}>
              {props.description}
            </p>
          </Show>
        </div>
      </Show>
    </header>
  );
}
