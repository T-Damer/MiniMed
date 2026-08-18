import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFindShortcutGate,
  isFindShortcut,
  NATIVE_FIND_DOUBLE_PRESS_MS,
  pickSearchFocusTarget,
} from '@/state/search-focus-target';

type MockElement = {
  disabled: boolean;
  readonly parentElement: MockElement | null;
  contains: (child: MockElement) => boolean;
  zIndex: string;
  visible: boolean;
};

function createElement(options: {
  readonly disabled?: boolean;
  readonly parent?: MockElement | null;
  readonly zIndex?: string;
  readonly visible?: boolean;
  readonly contains?: (child: MockElement) => boolean;
}): MockElement {
  return {
    disabled: options.disabled ?? false,
    parentElement: options.parent ?? null,
    zIndex: options.zIndex ?? 'auto',
    visible: options.visible ?? true,
    contains: options.contains ?? (() => false),
  };
}

function installDomMocks(root: {
  readonly candidates: readonly MockElement[];
  readonly modal?: MockElement | null;
}): ParentNode {
  vi.stubGlobal('getComputedStyle', (element: MockElement) => ({
    visibility: 'visible',
    zIndex: element.zIndex,
  }));

  const asNodeList = (items: readonly Element[]): NodeListOf<Element> =>
    Object.assign([...items], {
      item: (index: number) => items[index] ?? null,
      forEach: (callback: (value: Element) => void) => {
        items.forEach(callback);
      },
    }) as unknown as NodeListOf<Element>;

  return {
    querySelectorAll(selector: string) {
      if (selector === '[data-search-focus-target]') {
        return asNodeList(root.candidates as unknown as Element[]);
      }
      if (selector === '[aria-modal="true"], .overlay-dialog') {
        const modals = root.modal ? [root.modal as unknown as Element] : [];
        return asNodeList(modals);
      }
      return asNodeList([]);
    },
  } as ParentNode;
}

function stubClientRects(element: MockElement): void {
  Object.defineProperty(element, 'getClientRects', {
    value: () => (element.visible ? [{ width: 1, height: 1 }] : []),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isFindShortcut', () => {
  it('matches Ctrl/Cmd+F without Alt', () => {
    expect(isFindShortcut({ key: 'f', ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isFindShortcut({ key: 'F', ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
    expect(isFindShortcut({ key: 'f', ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
    expect(isFindShortcut({ key: 'g', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });
});

describe('createFindShortcutGate', () => {
  it('lets a second Ctrl/Cmd+F through within the double-press window', () => {
    const gate = createFindShortcutGate();
    expect(gate.shouldIntercept(1_000)).toBe(true);
    expect(gate.shouldIntercept(1_000 + NATIVE_FIND_DOUBLE_PRESS_MS)).toBe(false);
  });

  it('intercepts again after the double-press window', () => {
    const gate = createFindShortcutGate();
    expect(gate.shouldIntercept(1_000)).toBe(true);
    expect(gate.shouldIntercept(1_001 + NATIVE_FIND_DOUBLE_PRESS_MS)).toBe(true);
  });

  it('intercepts a third press after a native-find pass-through', () => {
    const gate = createFindShortcutGate(100);
    expect(gate.shouldIntercept(0)).toBe(true);
    expect(gate.shouldIntercept(50)).toBe(false);
    expect(gate.shouldIntercept(80)).toBe(true);
  });
});

describe('pickSearchFocusTarget', () => {
  it('prefers a visible target inside the topmost modal', () => {
    const background = createElement({ zIndex: '1' });
    const modalField = createElement({ zIndex: '10' });
    const modal = createElement({
      zIndex: '100',
      contains: (child) => child === modalField,
    });
    stubClientRects(background);
    stubClientRects(modalField);
    stubClientRects(modal);
    const root = installDomMocks({ candidates: [background, modalField], modal });
    expect(pickSearchFocusTarget(root)).toBe(modalField);
  });

  it('picks the highest z-index candidate outside modals', () => {
    const low = createElement({ zIndex: '1' });
    const high = createElement({ zIndex: '50' });
    stubClientRects(low);
    stubClientRects(high);
    const root = installDomMocks({ candidates: [low, high], modal: null });
    expect(pickSearchFocusTarget(root)).toBe(high);
  });

  it('tie-breaks equal z-index by later document order', () => {
    const first = createElement({ zIndex: '5' });
    const second = createElement({ zIndex: '5' });
    stubClientRects(first);
    stubClientRects(second);
    const root = installDomMocks({ candidates: [first, second], modal: null });
    expect(pickSearchFocusTarget(root)).toBe(second);
  });

  it('ignores disabled and hidden targets', () => {
    const hidden = createElement({ visible: false });
    const enabled = createElement({});
    stubClientRects(hidden);
    stubClientRects(enabled);
    const root = installDomMocks({ candidates: [hidden, enabled], modal: null });
    expect(pickSearchFocusTarget(root)).toBe(enabled);
  });
});
