import { describe, expect, it, vi } from 'vitest';

import { activateAppUpdate } from '@/state/app-update';

describe('app update activation', () => {
  it('waits for the user action before asking the worker to activate', () => {
    const postMessage = vi.fn();
    const addEventListener = vi.fn();
    const reload = vi.fn();

    activateAppUpdate({ postMessage }, { addEventListener }, reload);

    expect(addEventListener).toHaveBeenCalledWith('controllerchange', reload, { once: true });
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});
