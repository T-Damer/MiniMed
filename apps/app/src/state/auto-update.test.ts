import { describe, expect, it, vi } from 'vitest';

import { applyWhenQuiet, QUIET_START_MS, type QuietPage } from '@/state/auto-update';

function page(options: { now: number; touched?: boolean; hidden?: boolean }) {
  const listeners: (() => void)[] = [];
  const quiet: QuietPage = {
    startedAt: 0,
    now: () => options.now,
    hidden: () => options.hidden === true,
    touched: () => options.touched === true,
    onHidden(listener) {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  return {
    quiet,
    hide: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('updates that apply themselves', () => {
  it('applies at once while the app is still opening and untouched', () => {
    const apply = vi.fn();
    applyWhenQuiet(apply, page({ now: 2_000 }).quiet);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('waits for the page to hide once the user is working, then applies once', () => {
    const apply = vi.fn();
    const working = page({ now: QUIET_START_MS + 1, touched: true });
    applyWhenQuiet(apply, working.quiet);
    expect(apply).not.toHaveBeenCalled();
    working.hide();
    working.hide();
    expect(apply).toHaveBeenCalledOnce();
  });

  it('applies at once when found while the page is already hidden', () => {
    const apply = vi.fn();
    applyWhenQuiet(apply, page({ now: 60_000, touched: true, hidden: true }).quiet);
    expect(apply).toHaveBeenCalledOnce();
  });
});
