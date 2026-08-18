import { afterEach, describe, expect, it, vi } from 'vitest';

import { scrollYForStickyElement } from '@/components/sticky-surface';

type MockRoot = HTMLElement & { cssVarValue?: string };

function createNode(insideEnterView: boolean): Element {
  const enterAncestor = {};
  return {
    closest(selector: string) {
      if (insideEnterView && selector.includes('root-view-enter')) {
        return enterAncestor as Element;
      }
      return null;
    },
  } as Element;
}

function createRoot(cssVarValue?: string): MockRoot {
  return { cssVarValue } as MockRoot;
}

function installComputedStyleMock(): void {
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const value = (element as MockRoot).cssVarValue ?? '';
    return {
      getPropertyValue: (name: string) =>
        name === '--root-view-enter-to-scroll' ? value : '',
    } as CSSStyleDeclaration;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scrollYForStickyElement', () => {
  it('returns windowScrollY when the node is not inside an enter view', () => {
    installComputedStyleMock();
    const root = createRoot('120px');
    const node = createNode(false);

    expect(scrollYForStickyElement(node, 42, root)).toBe(42);
  });

  it('returns parsed --root-view-enter-to-scroll when inside root-view-enter-forward', () => {
    installComputedStyleMock();
    const root = createRoot('120px');
    const node = createNode(true);

    expect(scrollYForStickyElement(node, 42, root)).toBe(120);
  });

  it('returns parsed --root-view-enter-to-scroll when inside root-view-enter-backward', () => {
    installComputedStyleMock();
    const root = createRoot('88px');
    const node = createNode(true);

    expect(scrollYForStickyElement(node, 42, root)).toBe(88);
  });

  it('falls back to windowScrollY when the CSS var is missing inside an enter view', () => {
    installComputedStyleMock();
    const root = createRoot();
    const node = createNode(true);

    expect(scrollYForStickyElement(node, 42, root)).toBe(42);
  });

  it('falls back to windowScrollY when the CSS var is invalid inside an enter view', () => {
    installComputedStyleMock();
    const root = createRoot('not-a-number');
    const node = createNode(true);

    expect(scrollYForStickyElement(node, 42, root)).toBe(42);
  });
});
