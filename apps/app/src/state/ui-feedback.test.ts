import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/state/ui-sounds', () => ({
  uiSounds: {
    play: vi.fn(),
    hover: vi.fn(),
    clearHover: vi.fn(),
    unlock: vi.fn(),
    ensurePreferences: vi.fn(),
  },
}));

vi.mock('@/state/haptics', () => ({
  hapticFeedback: vi.fn(() => true),
}));

import { feedbackForClick, noteControlPointerDown, sonifiedControl } from '@/state/ui-feedback';

interface MockNode {
  readonly tagName: string;
  readonly parent: MockNode | null;
  disabled?: boolean;
  checked?: boolean;
  className?: string;
  role?: string;
  ariaChecked?: string;
  ariaPressed?: string;
  ariaDisabled?: string;
  ariaLabel?: string;
  href?: string;
  inputType?: string;
  onclick?: boolean;
  tabindex?: string;
  testId?: string;
  dataset?: Record<string, string>;
  matches(selector: string): boolean;
  closest(selector: string): MockNode | null;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  querySelector(selector: string): MockNode | null;
}

function matchesDeleteSelector(node: MockNode): boolean {
  return (
    node.className === 'danger' ||
    node.className === 'search-history-panel-remove' ||
    node.className === 'search-history-panel-clear' ||
    node.className === 'module-remove-button' ||
    node.ariaLabel?.startsWith('Удалить') === true ||
    node.ariaLabel === 'Очистить историю'
  );
}

function matchesSelectorList(node: MockNode, selector: string): boolean {
  const parts = selector.split(',').map((item) => item.trim());
  return parts.some((part) => nodeMatchesSelector(node, part));
}

function createNode(
  tagName: string,
  parent: MockNode | null = null,
  init: Partial<MockNode> = {},
): MockNode {
  const node: MockNode = {
    tagName: tagName.toUpperCase(),
    parent,
    matches(selector: string) {
      if (selector.includes('Удалить') || selector.includes('.danger')) {
        return matchesDeleteSelector(this);
      }
      if (selector === '.app-nav-button, .search-button, .content-download-nav__pie') {
        return (
          this.className?.includes('app-nav-button') === true || this.className === 'search-button'
        );
      }
      if (selector.includes('Распечатать')) {
        return (
          this.className === 'assessment-print-button' ||
          this.ariaLabel?.startsWith('Распечатать') === true
        );
      }
      if (selector.includes('Поделиться')) {
        return this.ariaLabel?.startsWith('Поделиться') === true;
      }
      if (selector.includes('search-submit') || selector.includes('search-button')) {
        return this.className === 'search-button' || this.testId === 'search-submit';
      }
      if (selector.includes('scroll-top-button')) {
        return this.className === 'scroll-top-button';
      }
      if (selector.includes('patient-notes-fab')) {
        return this.className === 'patient-notes-fab';
      }
      if (selector.includes('Закрыть историю') || selector.includes('Закрыть источник')) {
        return this.ariaLabel === 'Закрыть историю' || this.ariaLabel === 'Закрыть источник';
      }
      return matchesSelectorList(this, selector);
    },
    closest(selector: string) {
      let current: MockNode | null = this;
      const selectors = selector.split(',').map((item) => item.trim());
      while (current) {
        if (selectors.some((item) => nodeMatchesSelector(current as MockNode, item))) {
          return current;
        }
        current = current.parent;
      }
      return null;
    },
    hasAttribute(name: string) {
      if (name === 'onclick') return this.onclick === true;
      if (name === 'role') return this.role !== undefined;
      if (name === 'tabindex') return this.tabindex !== undefined;
      if (name === 'aria-pressed') return this.ariaPressed !== undefined;
      if (name === 'aria-checked') return this.ariaChecked !== undefined;
      if (name === 'aria-disabled') return this.ariaDisabled !== undefined;
      if (name === 'href') return this.href !== undefined;
      return false;
    },
    getAttribute(name: string) {
      if (name === 'role') return this.role ?? null;
      if (name === 'tabindex') return this.tabindex ?? null;
      if (name === 'aria-pressed') return this.ariaPressed ?? null;
      if (name === 'aria-checked') return this.ariaChecked ?? null;
      if (name === 'aria-disabled') return this.ariaDisabled ?? null;
      if (name === 'aria-label') return this.ariaLabel ?? null;
      if (name === 'type') return this.inputType ?? null;
      if (name === 'data-testid') return this.testId ?? null;
      return null;
    },
    querySelector(selector: string) {
      if (nodeMatchesSelector(this, selector)) return this;
      return null;
    },
    ...init,
  };
  return node;
}

function nodeMatchesSelector(node: MockNode, selector: string): boolean {
  if (selector === 'a[href]') return node.tagName === 'A' && node.href !== undefined;
  if (selector === 'button') return node.tagName === 'BUTTON';
  if (selector === '[role=button]') return node.role === 'button';
  if (selector === 'summary') return node.tagName === 'SUMMARY';
  if (selector === 'button, [role=button], summary') {
    return node.tagName === 'BUTTON' || node.role === 'button' || node.tagName === 'SUMMARY';
  }
  if (selector === 'input[type="radio"]') {
    return node.tagName === 'INPUT' && node.inputType === 'radio';
  }
  if (selector === 'input[type="range"]') {
    return node.tagName === 'INPUT' && node.inputType === 'range';
  }
  if (selector === 'label') return node.tagName === 'LABEL';
  if (selector === 'article') return node.tagName === 'ARTICLE';
  if (selector === '.paper-card') return node.className === 'paper-card';
  if (selector === '.module-card') return node.className === 'module-card';
  if (selector === '.danger') return node.className === 'danger';
  if (selector === '.search-history-panel-remove')
    return node.className === 'search-history-panel-remove';
  if (selector === '.search-history-panel-clear')
    return node.className === 'search-history-panel-clear';
  if (selector === '.module-remove-button') return node.className === 'module-remove-button';
  if (selector === '.assessment-print-button') return node.className === 'assessment-print-button';
  if (selector === '.search-button') return node.className === 'search-button';
  if (selector === '[data-testid="search-submit"]') return node.testId === 'search-submit';
  if (selector === '.scroll-top-button') return node.className === 'scroll-top-button';
  if (selector === '.patient-notes-fab') return node.className === 'patient-notes-fab';
  if (selector === '.note-image-picker') return node.className === 'note-image-picker';
  if (selector === '.note-reminder-fields__control')
    return node.className === 'note-reminder-fields__control';
  if (selector === '[aria-label="Очистить историю"]') return node.ariaLabel === 'Очистить историю';
  if (selector === '[aria-label="Закрыть историю"]') return node.ariaLabel === 'Закрыть историю';
  if (selector === '[aria-label="Закрыть источник"]') return node.ariaLabel === 'Закрыть источник';
  if (selector.startsWith('[aria-label^="Удалить"]'))
    return node.ariaLabel?.startsWith('Удалить') === true;
  if (selector.startsWith('[aria-label^="Распечатать"]'))
    return node.ariaLabel?.startsWith('Распечатать') === true;
  if (selector.startsWith('[aria-label^="Поделиться"]'))
    return node.ariaLabel?.startsWith('Поделиться') === true;
  if (selector.startsWith('article,')) {
    return (
      node.tagName === 'ARTICLE' ||
      node.className === 'paper-card' ||
      node.className === 'module-card'
    );
  }
  return false;
}

function asElement(node: MockNode): Element {
  const ElementCtor = Element as unknown as { new (): Element };
  if (node.tagName === 'BUTTON') {
    return Object.assign(Object.create(HTMLButtonElement.prototype), node, {
      disabled: node.disabled ?? false,
      dataset: node.dataset ?? {},
    }) as unknown as Element;
  }
  if (node.tagName === 'INPUT') {
    return Object.assign(Object.create(HTMLInputElement.prototype), node, {
      disabled: node.disabled ?? false,
      checked: node.checked ?? false,
      type: node.inputType ?? 'text',
      dataset: node.dataset ?? {},
    }) as unknown as Element;
  }
  return Object.assign(Object.create(ElementCtor.prototype), node, {
    dataset: node.dataset ?? {},
  }) as unknown as Element;
}

beforeEach(() => {
  class MockElement {}
  vi.stubGlobal('Element', MockElement);
  vi.stubGlobal('HTMLButtonElement', class HTMLButtonElement extends MockElement {});
  vi.stubGlobal('HTMLInputElement', class HTMLInputElement extends MockElement {});
});

describe('feedbackForClick', () => {
  it('maps links to forward feedback', () => {
    const link = createNode('a', null, { href: '#/settings' });
    expect(feedbackForClick(asElement(link))).toEqual({ cue: 'forward', haptic: 'light' });
  });

  it('maps toggles using the resulting pressed state', () => {
    const toggle = createNode('button', null, { role: 'switch', ariaChecked: 'true' });
    expect(feedbackForClick(asElement(toggle))).toEqual({ cue: 'toggle-on', haptic: 'light' });
    toggle.ariaChecked = 'false';
    expect(feedbackForClick(asElement(toggle))).toEqual({ cue: 'toggle-off', haptic: 'light' });
  });

  it('maps ordinary buttons to press feedback', () => {
    const button = createNode('button');
    expect(feedbackForClick(asElement(button))).toEqual({ cue: 'press', haptic: 'light' });
  });

  it('maps delete and danger controls to delete feedback with heavy haptics', () => {
    const danger = createNode('button', null, { className: 'danger' });
    expect(feedbackForClick(asElement(danger))).toEqual({ cue: 'delete', haptic: 'heavy' });

    const remove = createNode('button', null, { ariaLabel: 'Удалить заметку' });
    expect(feedbackForClick(asElement(remove))).toEqual({ cue: 'delete', haptic: 'heavy' });
  });

  it('maps search submit to start feedback with medium haptics', () => {
    const searchButton = createNode('button', null, { className: 'search-button' });
    expect(feedbackForClick(asElement(searchButton))).toEqual({ cue: 'start', haptic: 'medium' });
  });

  it('maps scroll-to-top to back feedback', () => {
    const scrollTop = createNode('button', null, { className: 'scroll-top-button' });
    expect(feedbackForClick(asElement(scrollTop))).toEqual({ cue: 'back', haptic: 'light' });
  });

  it('maps patient notes fab to open feedback', () => {
    const fab = createNode('button', null, { className: 'patient-notes-fab' });
    expect(feedbackForClick(asElement(fab))).toEqual({ cue: 'open', haptic: 'light' });
  });

  it('maps note image picker to open feedback', () => {
    const picker = createNode('label', null, { className: 'note-image-picker' });
    expect(feedbackForClick(asElement(picker))).toEqual({ cue: 'open', haptic: 'light' });
  });

  it('maps reminder date and time fields to select feedback', () => {
    const date = createNode('input', null, {
      inputType: 'date',
      className: 'note-reminder-fields__control',
    });
    const time = createNode('input', null, {
      inputType: 'time',
      className: 'note-reminder-fields__control',
    });
    expect(feedbackForClick(asElement(date))).toEqual({ cue: 'select', haptic: 'light' });
    expect(feedbackForClick(asElement(time))).toEqual({ cue: 'select', haptic: 'light' });
  });

  it('maps print controls to send feedback', () => {
    const print = createNode('button', null, { ariaLabel: 'Распечатать результат' });
    expect(feedbackForClick(asElement(print))).toEqual({ cue: 'send', haptic: 'light' });
  });

  it('maps clickable cards to select feedback', () => {
    const card = createNode('article', null, { ariaLabel: 'Открыть набор «Ядро»' });
    expect(feedbackForClick(asElement(card))).toEqual({ cue: 'select', haptic: 'light' });
  });

  it('maps unchecked radio options to select feedback', () => {
    const radio = createNode('input', null, { inputType: 'radio', checked: false });
    expect(feedbackForClick(asElement(radio))).toEqual({ cue: 'select', haptic: 'light' });
  });

  it('maps already-checked radio reselect to check feedback', () => {
    const radio = createNode('input', null, { inputType: 'radio', checked: true });
    const element = asElement(radio);
    noteControlPointerDown(element);
    expect(feedbackForClick(element)).toEqual({ cue: 'check', haptic: 'light' });
  });

  it('skips disabled controls', () => {
    const button = createNode('button', null, { disabled: true });
    expect(feedbackForClick(asElement(button))).toBeNull();
  });

  it('treats sliders as hoverable controls without a click cue', () => {
    const slider = asElement(createNode('input', null, { inputType: 'range' }));
    expect(sonifiedControl(slider)).toBe(slider);
    expect(feedbackForClick(slider)).toBeNull();
  });
});
