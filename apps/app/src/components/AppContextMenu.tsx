import { ContextMenu } from '@kobalte/core/context-menu';
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';

export interface AppContextMenuAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: AppGlyphName;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly children?: readonly AppContextMenuAction[];
  readonly onSelect?: () => void;
}

interface AppContextMenuProps {
  readonly children: JSX.Element;
  readonly actions: readonly AppContextMenuAction[];
  readonly buttonLabel?: string;
  readonly buttonIcon?: AppGlyphName;
  readonly buttonClass?: string;
  readonly hideButton?: boolean;
  readonly class?: string;
}

/** Opens the nearest context menu synthetically (e.g. from a left click). */
export function requestContextMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const currentTarget = event.currentTarget;
  if (!(currentTarget instanceof HTMLElement)) return;
  const trigger = currentTarget.closest<HTMLElement>('[data-app-context-menu-trigger]');
  if (!trigger) return;
  const rect = currentTarget.getBoundingClientRect();
  trigger.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.bottom),
      button: 2,
    }),
  );
}

function MenuItem(props: { readonly action: AppContextMenuAction }): JSX.Element {
  return (
    <Show
      when={(props.action.children?.length ?? 0) > 0}
      fallback={
        <ContextMenu.Item
          class="app-context-menu__item"
          classList={{ 'app-context-menu__item--danger': Boolean(props.action.danger) }}
          disabled={props.action.disabled ?? false}
          onClick={(event) => event.stopPropagation()}
          onSelect={() => props.action.onSelect?.()}
        >
          <Show when={props.action.icon}>
            {(icon) => <AppGlyph name={icon()} class="app-context-menu__item-icon" />}
          </Show>
          <span class="app-context-menu__item-label">{props.action.label}</span>
        </ContextMenu.Item>
      }
    >
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger
          class="app-context-menu__item app-context-menu__item--submenu"
          disabled={props.action.disabled ?? false}
        >
          <Show when={props.action.icon}>
            {(icon) => <AppGlyph name={icon()} class="app-context-menu__item-icon" />}
          </Show>
          <span class="app-context-menu__item-label">{props.action.label}</span>
          <span class="app-context-menu__submenu-arrow" aria-hidden="true">
            ›
          </span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent class="app-context-menu app-context-menu--sub">
            <For each={props.action.children}>{(action) => <MenuItem action={action} />}</For>
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
    </Show>
  );
}

export function AppContextMenu(props: AppContextMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false);

  // Non-modal menus let the page scroll freely; the first scroll gesture
  // outside the menu closes it via a synthesized outside press.
  createEffect(() => {
    if (!open()) return;
    const closeOnScroll = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('.app-context-menu')) return;
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    };
    window.addEventListener('wheel', closeOnScroll, { capture: true, passive: true });
    window.addEventListener('touchmove', closeOnScroll, { capture: true, passive: true });
    window.addEventListener('scroll', closeOnScroll, { capture: true, passive: true });
    onCleanup(() => {
      window.removeEventListener('wheel', closeOnScroll, { capture: true });
      window.removeEventListener('touchmove', closeOnScroll, { capture: true });
      window.removeEventListener('scroll', closeOnScroll, { capture: true });
    });
  });

  return (
    <ContextMenu modal={false} preventScroll={false} onOpenChange={setOpen}>
      <ContextMenu.Trigger
        class={`app-context-menu__trigger${props.class ? ` ${props.class}` : ''}`}
        data-app-context-menu-trigger=""
      >
        {props.children}
        <Show when={!props.hideButton}>
          <button
            type="button"
            class={`app-context-menu__more${props.buttonClass ? ` ${props.buttonClass}` : ''}`}
            aria-label={props.buttonLabel ?? 'Действия'}
            title={props.buttonLabel ?? 'Действия'}
            onClick={requestContextMenu}
          >
            <Show when={props.buttonIcon} fallback={<span aria-hidden="true">•••</span>}>
              {(icon) => <AppGlyph name={icon()} class="app-context-menu__more-icon" />}
            </Show>
          </button>
        </Show>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="app-context-menu">
          <For each={props.actions}>{(action) => <MenuItem action={action} />}</For>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
