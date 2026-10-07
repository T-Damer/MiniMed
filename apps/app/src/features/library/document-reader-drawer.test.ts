import { describe, expect, it } from 'vitest';

import {
  isOutlineDrawerOpen,
  shouldCloseOutlineOnEscape,
} from '@/features/library/document-reader-drawer';

const escapeKey = { key: 'Escape', defaultPrevented: false, isComposing: false } as const;

describe('isOutlineDrawerOpen', () => {
  it('is a drawer only on the phone layout', () => {
    expect(isOutlineDrawerOpen(true, false)).toBe(true);
    expect(isOutlineDrawerOpen(true, true)).toBe(false);
    expect(isOutlineDrawerOpen(false, false)).toBe(false);
  });
});

describe('shouldCloseOutlineOnEscape', () => {
  it('closes an open drawer', () => {
    expect(shouldCloseOutlineOnEscape(escapeKey, { drawerOpen: true, findOpen: false })).toBe(true);
  });

  it('leaves Escape to the open find field, other handlers and a closed drawer', () => {
    expect(shouldCloseOutlineOnEscape(escapeKey, { drawerOpen: true, findOpen: true })).toBe(false);
    expect(
      shouldCloseOutlineOnEscape(
        { ...escapeKey, defaultPrevented: true },
        { drawerOpen: true, findOpen: false },
      ),
    ).toBe(false);
    expect(shouldCloseOutlineOnEscape(escapeKey, { drawerOpen: false, findOpen: false })).toBe(
      false,
    );
  });

  it('ignores other keys and IME composition', () => {
    expect(
      shouldCloseOutlineOnEscape({ ...escapeKey, key: 'a' }, { drawerOpen: true, findOpen: false }),
    ).toBe(false);
    expect(
      shouldCloseOutlineOnEscape(
        { ...escapeKey, isComposing: true },
        { drawerOpen: true, findOpen: false },
      ),
    ).toBe(false);
  });
});
