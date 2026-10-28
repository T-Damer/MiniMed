import { createMemo, createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  HEADER_ROW_ATTRIBUTE,
  HEADER_TITLE_ATTRIBUTE,
  type HeaderAction,
  HeaderActions,
} from '@/components/HeaderActions';
import { type PageHero, PageHeroBand, useHeroBleed, useHeroScroll } from '@/components/PageHero';
import { SheetPopover } from '@/components/SheetPopover';
import { visitRoute } from '@/state/app-back';

export interface PageProps {
  readonly class?: string;
  readonly navigation?: JSX.Element;
  readonly navigationClass?: string;
  readonly breadcrumbs?: JSX.Element;
  readonly icon?: JSX.Element;
  readonly title?: JSX.Element;
  /**
   * The section this page belongs to, as a small link above the title: a doctor who returns to a
   * tab and lands on one of its inner pages sees where they are («Лента › Источники»).
   */
  readonly parent?: { readonly label: string; readonly href: string } | undefined;
  readonly description?: JSX.Element;
  readonly actions?: JSX.Element;
  /**
   * Header buttons that fold into a «⋯» menu when the row runs out of width, lowest priority first
   * (`HeaderActions`). The «?» help takes part as a priority-1 action. Memoise the array.
   */
  readonly headerActions?: readonly HeaderAction[] | undefined;
  /** «Как это работает» and other explanations: a round «?» in the header opens it. */
  readonly help?: JSX.Element;
  /** Heading of the help panel; «Как это работает» by default. */
  readonly helpTitle?: string;
  /**
   * The page's band: the header sits on it, the page slides over it, and the header shrinks into a
   * bar that keeps its row (`app/page-heroes.ts`). Readers, forms and editors have none.
   */
  readonly hero?: PageHero | undefined;
}

/**
 * Route header. With a back button or header tools the title sits in the same row between them
 * (AGENTS.md «Interface rules»); the description is one quiet line under that row.
 */
export function Page(props: PageProps): JSX.Element {
  const className = (base: string, extra?: string): string => (extra ? `${base} ${extra}` : base);
  const [helpOpen, setHelpOpen] = createSignal(false);
  let headerElement: HTMLElement | undefined;
  let rowElement: HTMLDivElement | undefined;
  useHeroScroll(
    () => headerElement,
    () => rowElement,
    () => props.hero !== undefined,
  );
  useHeroBleed(
    () => headerElement,
    () => props.hero !== undefined,
  );
  const inline = (): boolean =>
    props.title !== undefined &&
    props.breadcrumbs === undefined &&
    (props.navigation !== undefined ||
      props.actions !== undefined ||
      props.headerActions !== undefined ||
      props.help !== undefined);
  const helpTitle = (): string => props.helpTitle ?? 'Как это работает';
  /** With `headerActions` the «?» is one of them (priority 1, first), so it folds into «⋯» too. */
  const foldableActions = createMemo((): readonly HeaderAction[] | undefined => {
    const own = props.headerActions;
    if (own === undefined) return undefined;
    if (props.help === undefined) return own;
    return [
      {
        id: 'help',
        label: helpTitle(),
        icon: 'question',
        priority: 1,
        panel: {
          content: () => <div class="page__help-body">{props.help}</div>,
          contentClass: 'page__help-panel',
        },
      },
      ...own,
    ];
  });

  const titleRow = (): JSX.Element => (
    <div
      class="page__title-row"
      classList={{
        'page__title-row--inline': inline(),
        'page__title-row--hero': inline() && props.hero !== undefined,
      }}
      {...(inline() ? { [HEADER_TITLE_ATTRIBUTE]: '' } : {})}
    >
      <Show when={props.icon !== undefined && !inline()}>
        <div class="page__icon">{props.icon}</div>
      </Show>
      <div class="page__title">
        <Show when={props.parent}>
          {(parent) => (
            <a
              class="page__parent"
              classList={{ 'page__parent--hero': props.hero !== undefined }}
              href={parent().href}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                visitRoute(parent().href);
              }}
            >
              {parent().label}
              <AppGlyph name="caret-right" class="page__parent-icon" />
            </a>
          )}
        </Show>
        {props.title}
      </div>
    </div>
  );

  return (
    <header
      ref={(element) => {
        headerElement = element;
      }}
      class={`page ${props.class ?? ''}`}
      classList={{
        'page--inline': inline(),
        'page--hero': props.hero !== undefined,
        'page--hero-trace': props.hero?.ambient === 'ecg',
      }}
    >
      <Show when={props.hero}>{(hero) => <PageHeroBand hero={hero()} />}</Show>
      <Show
        when={
          props.navigation !== undefined ||
          props.breadcrumbs !== undefined ||
          props.actions !== undefined ||
          props.headerActions !== undefined ||
          props.help !== undefined
        }
      >
        <div
          ref={(element) => {
            rowElement = element;
          }}
          class="page__above-header"
          classList={{ 'page__above-header--hero': props.hero !== undefined }}
          {...{ [HEADER_ROW_ATTRIBUTE]: '' }}
        >
          <Show when={props.navigation !== undefined}>
            <div class={className('page__left-actions', props.navigationClass)}>
              {props.navigation}
            </div>
          </Show>
          <Show when={props.breadcrumbs !== undefined}>
            <div class="page__breadcrumbs">{props.breadcrumbs}</div>
          </Show>
          <Show when={inline()}>{titleRow()}</Show>
          <Show
            when={
              props.actions !== undefined ||
              props.headerActions !== undefined ||
              props.help !== undefined
            }
          >
            <div class="page__right-actions">
              <Show when={foldableActions()}>
                {(actions) => <HeaderActions actions={actions()} />}
              </Show>
              <Show when={props.help !== undefined && props.headerActions === undefined}>
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
        <div class="page__header" classList={{ 'page__header--hero': props.hero !== undefined }}>
          <Show when={!inline() && (props.icon !== undefined || props.title !== undefined)}>
            {titleRow()}
          </Show>
          <Show when={props.description !== undefined}>
            <p
              class="page__description"
              classList={{
                'page__description--inline': inline(),
                'page__description--hero': props.hero !== undefined,
              }}
            >
              {props.description}
            </p>
          </Show>
        </div>
      </Show>
      <Show when={props.hero}>
        {(hero) => (
          <div
            class="page__hero-room"
            classList={{ 'page__hero-room--trace': hero().ambient === 'ecg' }}
            aria-hidden="true"
          />
        )}
      </Show>
    </header>
  );
}
