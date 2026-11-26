import { For, type JSX, Show } from 'solid-js';
import { AppContextMenu } from '@/components/AppContextMenu';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import type { ChatText } from '@/diary/companion-message-format';
import { formatTime } from '@/diary/diary-format';
import type { DiaryPlanChange } from '@/features/diary/plan-changes';

export const CHAT_REACTIONS = [
  { glyph: '❤️', label: 'Сердце' },
  { glyph: '😢', label: 'Грусть' },
  { glyph: '😊', label: 'Радость' },
  { glyph: '🔥', label: 'Огонь' },
] as const;
export type ChatReaction = (typeof CHAT_REACTIONS)[number]['glyph'];

export interface ChatQuote {
  readonly id: string;
  readonly author: string;
  readonly text: string;
}

export function CompanionQuote(props: {
  readonly quote: ChatQuote;
  readonly open: () => void;
}): JSX.Element {
  return (
    <button type="button" class="companion-chat__quote" onClick={props.open}>
      <strong class="companion-chat__quote-author">{props.quote.author}</strong>
      <span class="companion-chat__quote-text">{props.quote.text}</span>
    </button>
  );
}

export function CompanionMessageRow(props: {
  readonly id?: string;
  readonly outgoing: boolean;
  readonly at: string;
  readonly text: string;
  readonly author?: string | undefined;
  readonly blocks?: readonly ChatText[] | undefined;
  readonly card?: JSX.Element;
  readonly actions?: JSX.Element;
  readonly diaryAction?: JSX.Element;
  readonly quote?: JSX.Element;
  readonly details?: JSX.Element;
  readonly reaction?: ChatReaction | undefined;
  readonly onReact?: (reaction: ChatReaction) => void;
  readonly onReply?: (() => void) | undefined;
}): JSX.Element {
  let swipe: { id: number; x: number; y: number } | undefined;
  const horizontalSwipe = (event: PointerEvent): number => {
    if (!swipe || swipe.id !== event.pointerId) return 0;
    const left = swipe.x - event.clientX;
    return left > Math.abs(event.clientY - swipe.y) * 1.5 ? left : 0;
  };
  return (
    <div
      id={props.id}
      class="companion-chat__turn"
      classList={{ 'companion-chat__turn--patient': props.outgoing }}
      onPointerDown={(event) => {
        if (
          props.onReply &&
          event.pointerType === 'touch' &&
          event.isPrimary &&
          !(event.target instanceof Element && event.target.closest('button, a'))
        ) {
          swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }
      }}
      onPointerMove={(event) => {
        if (swipe?.id !== event.pointerId) return;
        event.currentTarget.style.setProperty(
          '--companion-swipe',
          `${-Math.min(64, horizontalSwipe(event))}px`,
        );
      }}
      onPointerUp={(event) => {
        const reply = horizontalSwipe(event) >= 52;
        swipe = undefined;
        event.currentTarget.style.removeProperty('--companion-swipe');
        if (reply) props.onReply?.();
      }}
      onPointerCancel={(event) => {
        swipe = undefined;
        event.currentTarget.style.removeProperty('--companion-swipe');
      }}
    >
      <AppContextMenu
        hideButton
        {...(props.onReply || props.onReact ? { discoverLabel: 'Действия с сообщением' } : {})}
        discoverClass="companion-chat__message-dots"
        class="companion-chat__message-menu"
        actions={[
          ...(props.onReply
            ? [
                {
                  id: 'reply',
                  label: 'Ответить',
                  icon: 'arrow-u-up-left' as const,
                  onSelect: props.onReply,
                },
              ]
            : []),
          ...CHAT_REACTIONS.flatMap(({ glyph, label }) =>
            props.onReact
              ? [
                  {
                    id: glyph,
                    label: `${glyph} ${label}`,
                    icon: 'smiley' as const,
                    onSelect: () => props.onReact?.(glyph),
                  },
                ]
              : [],
          ),
        ]}
      >
        <div
          class="companion-chat__bubble"
          classList={{
            'companion-chat__bubble--patient': props.outgoing,
            'companion-chat__bubble--companion': !props.outgoing,
          }}
        >
          <Show when={props.author}>
            <strong class="diary-thread__author">{props.author}</strong>
          </Show>
          {props.quote}
          {props.card ?? (
            <>
              <CompanionMessageText text={props.text} blocks={props.blocks} />
              {props.details}
            </>
          )}
          <time class="companion-chat__time" dateTime={props.at}>
            {formatTime(props.at)}
          </time>
        </div>
      </AppContextMenu>
      <div class="companion-chat__message-controls">
        <Show when={props.reaction}>
          {(reaction) => (
            <button
              type="button"
              class="companion-chat__reaction"
              aria-label={`Убрать реакцию ${reaction()}`}
              aria-pressed="true"
              onClick={() => props.onReact?.(reaction())}
            >
              <span class="companion-chat__emoji" aria-hidden="true">
                {reaction()}
              </span>
            </button>
          )}
        </Show>
        <Show when={props.outgoing}>{props.diaryAction}</Show>
      </div>
      {props.actions}
    </div>
  );
}

export function CompanionPlanUpdate(props: { readonly change: DiaryPlanChange }): JSX.Element {
  return (
    <section class="companion-chat__plan-update" aria-label="Врач изменил назначение">
      <strong class="companion-chat__plan-update-title">Врач изменил назначение</strong>
      <For each={props.change.prescriptions}>
        {(item) => (
          <div class="companion-chat__plan-comparison">
            <Show when={item.before}>
              {(before) => (
                <p class="companion-chat__plan-before">
                  <strong>Было</strong> {before()}
                </p>
              )}
            </Show>
            <Show when={item.after}>
              {(after) => (
                <p class="companion-chat__plan-after">
                  <strong>Стало</strong> {after()}
                </p>
              )}
            </Show>
          </div>
        )}
      </For>
      <For each={props.change.lines}>
        {(line) => <p class="companion-chat__paragraph">{line}</p>}
      </For>
    </section>
  );
}

export function CompanionMessageAction(props: {
  readonly label: string;
  readonly icon: AppGlyphName;
  readonly emphasis?: boolean;
  readonly run: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="companion-chat__reply"
      classList={{ 'companion-chat__reply--primary': props.emphasis }}
      onClick={props.run}
    >
      <AppGlyph name={props.icon} class="companion-chat__reply-icon" />
      {props.label}
    </button>
  );
}

export function CompanionEmojiPicker(props: { readonly insert: (emoji: string) => void }) {
  return (
    <fieldset class="companion-chat__text-tools" aria-label="Смайлы">
      <For each={CHAT_REACTIONS}>
        {(format) => (
          <button
            type="button"
            class="companion-chat__format"
            aria-label={format.label}
            title={format.label}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => props.insert(format.glyph)}
          >
            <span class="companion-chat__emoji" aria-hidden="true">
              {format.glyph}
            </span>
          </button>
        )}
      </For>
    </fieldset>
  );
}

function RenderNode(props: { readonly node: ChatText }): JSX.Element {
  const node = props.node;
  if (node.kind === 'text') return node.text;
  const content = <For each={node.children}>{(child) => <RenderNode node={child} />}</For>;
  switch (node.kind) {
    case 'paragraph':
      return <p class="companion-chat__paragraph">{content}</p>;
    case 'bold':
      return <strong>{content}</strong>;
    case 'italic':
      return <em>{content}</em>;
    case 'list':
      return <ul class="companion-chat__list">{content}</ul>;
    case 'numbered':
      return <ol class="companion-chat__list">{content}</ol>;
    case 'item':
      return <li class="companion-chat__list-item">{content}</li>;
  }
}

function CompanionMessageText(props: {
  readonly text: string;
  readonly blocks?: readonly ChatText[] | undefined;
}) {
  return (
    <Show when={props.blocks} fallback={props.text}>
      {(blocks) => <For each={blocks()}>{(node) => <RenderNode node={node} />}</For>}
    </Show>
  );
}
