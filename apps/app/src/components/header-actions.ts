/**
 * Header overflow, as pure logic (owner 2026-10-27): which header buttons stay inline and which
 * fold into one «⋯» menu when the header row runs out of width.
 *
 * Priority 1 is the most important (folded last), priority 3 folds first. A single button is never
 * folded: the «⋯» button takes a slot of its own, so folding one button gains nothing.
 */

export type HeaderActionPriority = 1 | 2 | 3;

export interface HeaderActionSize {
  readonly id: string;
  readonly priority: HeaderActionPriority;
  /** Width of the inline button, px. */
  readonly width: number;
  /** Always in the «⋯» menu (account and rare actions), whatever the width. */
  readonly menuOnly?: boolean;
}

export interface HeaderActionsBudget {
  /** Actions in display order. */
  readonly actions: readonly HeaderActionSize[];
  /** Width the actions may occupy, px (may be negative when even the title does not fit). */
  readonly available: number;
  /** Width of the «⋯» button, px. */
  readonly menuWidth: number;
  /** Gap between neighbouring buttons, px. */
  readonly gap: number;
}

export interface HeaderActionsLayout {
  /** Ids shown as buttons, in display order. */
  readonly inline: readonly string[];
  /** Ids folded into the «⋯» menu, in display order. */
  readonly menu: readonly string[];
}

/** Width of a row of `count` items of total width `sum` separated by `gap`. */
function rowWidth(sum: number, count: number, gap: number): number {
  return count === 0 ? 0 : sum + gap * (count - 1);
}

/**
 * Folds lowest priority first (3, then 2, then 1); within a priority the later button folds first.
 * Never folds exactly one button; with every button folded only the «⋯» button remains.
 */
export function layoutHeaderActions(budget: HeaderActionsBudget): HeaderActionsLayout {
  const { available, menuWidth, gap } = budget;
  const ids = budget.actions.map((action) => action.id);
  const fixed = new Set(budget.actions.filter((action) => action.menuOnly).map((a) => a.id));
  if (fixed.size) {
    // The «⋯» button is there anyway, so any number of buttons may join it.
    const rest = budget.actions.filter((action) => !fixed.has(action.id));
    const order = rest
      .map((action, index) => ({ action, index }))
      .sort((a, b) => b.action.priority - a.action.priority || b.index - a.index);
    let sum = rest.reduce((total, action) => total + action.width, 0);
    let count = rest.length;
    for (const { action } of order) {
      if (rowWidth(sum + menuWidth, count + 1, gap) <= available) break;
      fixed.add(action.id);
      sum -= action.width;
      count -= 1;
    }
    return {
      inline: ids.filter((id) => !fixed.has(id)),
      menu: ids.filter((id) => fixed.has(id)),
    };
  }
  const { actions } = budget;
  const total = actions.reduce((sum, action) => sum + action.width, 0);
  if (rowWidth(total, actions.length, gap) <= available) return { inline: ids, menu: [] };
  // One button alone cannot be folded: there would be nothing to gain.
  if (actions.length < 2) return { inline: ids, menu: [] };

  const foldOrder = actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => b.action.priority - a.action.priority || b.index - a.index);

  const folded = new Set<string>();
  let inlineSum = total;
  let inlineCount = actions.length;
  const fits = (): boolean => rowWidth(inlineSum + menuWidth, inlineCount + 1, gap) <= available;

  for (const { action } of foldOrder) {
    if (folded.size >= 2 && fits()) break;
    folded.add(action.id);
    inlineSum -= action.width;
    inlineCount -= 1;
  }

  return {
    inline: ids.filter((id) => !folded.has(id)),
    menu: ids.filter((id) => folded.has(id)),
  };
}

/** Whether two layouts show the same buttons (skips a redundant re-render). */
export function sameHeaderLayout(a: HeaderActionsLayout, b: HeaderActionsLayout): boolean {
  return (
    a.menu.length === b.menu.length &&
    a.inline.length === b.inline.length &&
    a.menu.every((id, index) => id === b.menu[index])
  );
}
