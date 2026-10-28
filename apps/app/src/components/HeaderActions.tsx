import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppContextMenu, type AppContextMenuAction } from '@/components/AppContextMenu';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  type HeaderActionPriority,
  type HeaderActionsLayout,
  layoutHeaderActions,
  sameHeaderLayout,
} from '@/components/header-actions';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SheetPopover } from '@/components/SheetPopover';

import '@/components/HeaderActions.css';

export type { HeaderActionPriority } from '@/components/header-actions';

/** A panel an action opens instead of running a callback («?» help): a popover or a bottom sheet. */
export interface HeaderActionPanel {
  /** Heading of the panel; the action label by default. */
  readonly title?: string;
  readonly content: () => JSX.Element;
  readonly contentClass?: string;
}

export interface HeaderAction {
  readonly id: string;
  /** Accessible name of the inline button and the label of the menu item. */
  readonly label: string;
  readonly icon: AppGlyphName;
  /** 1 folds into «⋯» last, 3 first. */
  readonly priority: HeaderActionPriority;
  readonly onSelect?: () => void;
  /** Opens a panel (popover on wide screens, sheet when folded or on phones) instead of `onSelect`. */
  readonly panel?: HeaderActionPanel;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  /** Always in the «⋯» menu: account and rare actions (reminders, sign-out). */
  readonly menuOnly?: boolean;
  /** Stable hook for tests and automation, on the inline button and on the menu item. */
  readonly testId?: string;
}

export interface HeaderActionsProps {
  /** Actions in display order. Keep the array stable between renders (memoise it). */
  readonly actions: readonly HeaderAction[];
}

/** Marks the header row whose width is shared by the title and the buttons. */
export const HEADER_ROW_ATTRIBUTE = 'data-header-row';
/** Marks the title block of that row: it keeps its natural width, the buttons fold before it truncates. */
export const HEADER_TITLE_ATTRIBUTE = 'data-header-title';

/** Width of an icon button before anything is measured (`--ui-icon-button-size`, 2.75rem). */
const FALLBACK_BUTTON_WIDTH = 44;

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Whether the element takes part in layout (display: none removes its boxes). */
function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Width a title block wants with all its text on one line. A hidden clone placed beside the original
 * (so it inherits the same styles) is measured and removed again: `scrollWidth` of a wrapped title
 * reports the box, not the text.
 */
function naturalWidth(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent) return element.getBoundingClientRect().width;
  const probe = element.cloneNode(true) as HTMLElement;
  probe.removeAttribute('id');
  for (const node of Array.from(probe.querySelectorAll('[id]'))) node.removeAttribute('id');
  probe.setAttribute('aria-hidden', 'true');
  probe.removeAttribute(HEADER_TITLE_ATTRIBUTE);
  probe.style.cssText =
    'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;width:max-content;max-width:none;flex:none;white-space:nowrap;contain:layout style;';
  parent.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

/**
 * Header buttons that fold into one «⋯» menu when the header row runs out of width (owner
 * 2026-10-27, AGENTS.md «Header overflow»).
 *
 * The row is the nearest `[data-header-row]` (`Page` marks its header row) or the parent element;
 * its `[data-header-title]` child counts at its natural one-line width, so a long patient name
 * claims space first and the buttons fold before the title truncates. Lowest priority folds first;
 * a single button is never folded (see `layoutHeaderActions`). Nothing is shown until the first
 * measurement, so the row never flashes buttons that are then folded.
 */
export function HeaderActions(props: HeaderActionsProps): JSX.Element {
  let host: HTMLDivElement | undefined;
  const [layout, setLayout] = createSignal<HeaderActionsLayout | undefined>(undefined);
  const [openPanel, setOpenPanel] = createSignal<string | undefined>(undefined);
  let buttonWidth = FALLBACK_BUTTON_WIDTH;

  const foldedIds = createMemo((): ReadonlySet<string> => new Set(layout()?.menu ?? []));
  const folded = (id: string): boolean => foldedIds().has(id);
  const menuActions = createMemo((): readonly AppContextMenuAction[] =>
    props.actions
      .filter((action) => foldedIds().has(action.id))
      .map((action) => ({
        id: action.id,
        label: action.label,
        icon: action.icon,
        ...(action.danger ? { danger: true } : {}),
        ...(action.disabled ? { disabled: true } : {}),
        ...(action.testId ? { testId: action.testId } : {}),
        onSelect: () => {
          if (action.panel) setOpenPanel(action.id);
          else action.onSelect?.();
        },
      })),
  );

  function measure(): boolean {
    if (!host?.isConnected) return false;
    const row = host.closest<HTMLElement>(`[${HEADER_ROW_ATTRIBUTE}]`) ?? host.parentElement;
    if (!row) return false;

    // Reads first, then the one write (the title probe), so a measurement is a single reflow.
    const rowStyle = getComputedStyle(row);
    const rowGap = pixels(rowStyle.columnGap);
    const inner = row.clientWidth - pixels(rowStyle.paddingLeft) - pixels(rowStyle.paddingRight);
    if (inner <= 0) return false;

    let slot: HTMLElement = host;
    while (slot.parentElement && slot.parentElement !== row) slot = slot.parentElement;

    const sample = host.querySelector<HTMLElement>('.header-actions__button');
    if (sample && isRendered(sample)) buttonWidth = sample.getBoundingClientRect().width;
    const hostGap = pixels(getComputedStyle(host).columnGap);

    let used = 0;
    let neighbours = 0;
    const titles: HTMLElement[] = [];
    for (const child of Array.from(row.children)) {
      if (child === slot || !(child instanceof HTMLElement) || !isRendered(child)) continue;
      neighbours += 1;
      if (child.hasAttribute(HEADER_TITLE_ATTRIBUTE)) titles.push(child);
      else used += child.getBoundingClientRect().width;
    }
    // What shares the slot with the buttons (other tools of the same header group).
    const slotExtras =
      slot === host ? 0 : slot.getBoundingClientRect().width - host.getBoundingClientRect().width;
    for (const title of titles) used += Math.ceil(naturalWidth(title)) + 1;

    const available = Math.floor(inner - used - rowGap * neighbours - slotExtras);
    const next = layoutHeaderActions({
      actions: props.actions.map((action) => ({
        id: action.id,
        priority: action.priority,
        width: buttonWidth,
        ...(action.menuOnly ? { menuOnly: true } : {}),
      })),
      available,
      menuWidth: buttonWidth,
      gap: hostGap,
    });
    const current = layout();
    if (!current || !sameHeaderLayout(current, next)) setLayout(next);
    return true;
  }

  let frame = 0;
  function schedule(): void {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  }

  onMount(() => {
    const element = host;
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') {
      setLayout({
        inline: props.actions.filter((action) => !action.menuOnly).map((action) => action.id),
        menu: props.actions.filter((action) => action.menuOnly).map((action) => action.id),
      });
      return;
    }
    // The first measurement is synchronous (before paint); later ones are coalesced per frame.
    measure();
    const row = element.closest<HTMLElement>(`[${HEADER_ROW_ATTRIBUTE}]`) ?? element.parentElement;
    if (!row) return;
    const resize = new ResizeObserver(() => {
      if (layout() === undefined) measure();
      else schedule();
    });
    const observeNeighbours = (): void => {
      resize.disconnect();
      resize.observe(row);
      for (const child of Array.from(row.children)) {
        if (child.contains(element)) continue;
        resize.observe(child);
      }
    };
    observeNeighbours();
    const mutation = new MutationObserver((records) => {
      // Our own folding changes the host subtree; only the title and its neighbours matter.
      if (records.every((record) => element.contains(record.target))) return;
      if (records.some((record) => record.target === row)) observeNeighbours();
      schedule();
    });
    mutation.observe(row, { childList: true, characterData: true, subtree: true });
    void document.fonts?.ready.then(schedule);
    onCleanup(() => {
      resize.disconnect();
      mutation.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    });
  });

  // A changed set of buttons is measured again before the next paint.
  createEffect(
    on(
      () =>
        props.actions
          .map((action) => `${action.id}:${action.priority}:${action.menuOnly ? 'm' : ''}`)
          .join('|'),
      () => schedule(),
      { defer: true },
    ),
  );

  return (
    <div
      ref={host}
      class="header-actions"
      classList={{ 'header-actions--pending': layout() === undefined }}
    >
      <For each={props.actions}>
        {(action) => (
          <>
            <Show when={!folded(action.id)}>
              <Show
                when={action.panel}
                fallback={
                  <Button
                    variant="icon"
                    class={`header-actions__button${action.danger ? ' header-actions__button--danger' : ''}`}
                    aria-label={action.label}
                    title={action.label}
                    disabled={action.disabled ?? false}
                    data-testid={action.testId}
                    icon={<AppGlyph name={action.icon} class="header-actions__icon" />}
                    onClick={() => action.onSelect?.()}
                  />
                }
              >
                {(panel) => (
                  <SheetPopover
                    open={openPanel() === action.id}
                    onOpenChange={(open) => setOpenPanel(open ? action.id : undefined)}
                    title={panel().title ?? action.label}
                    triggerClass="ui-button ui-button--icon header-actions__button"
                    triggerLabel={action.label}
                    triggerTitle={action.label}
                    trigger={<AppGlyph name={action.icon} class="header-actions__icon" />}
                    contentClass={panel().contentClass ?? 'header-actions__panel'}
                    placement="bottom-end"
                  >
                    {panel().content()}
                  </SheetPopover>
                )}
              </Show>
            </Show>
            {/* Folded into «⋯»: the panel opens as a sheet, there is no button to anchor it to. */}
            <Show when={folded(action.id) ? action.panel : undefined}>
              {(panel) => (
                <OverlayDialog
                  open={openPanel() === action.id}
                  title={panel().title ?? action.label}
                  class="sheet-popover"
                  onClose={() => setOpenPanel(undefined)}
                >
                  <div
                    class={`${panel().contentClass ?? 'header-actions__panel'} sheet-popover__content`}
                  >
                    {panel().content()}
                  </div>
                </OverlayDialog>
              )}
            </Show>
          </>
        )}
      </For>
      <Show when={menuActions().length > 0}>
        <AppContextMenu
          actions={menuActions()}
          buttonLabel="Ещё"
          buttonIcon="dots-three"
          buttonClass="header-actions__more"
          class="header-actions__menu"
        >
          {null}
        </AppContextMenu>
      </Show>
    </div>
  );
}
