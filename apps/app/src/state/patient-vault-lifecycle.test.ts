import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installPatientVaultLifecycle,
  PATIENT_VAULT_LOCK_EVENT,
  PATIENT_VAULT_UI_CLEARED_EVENT,
} from '@/state/patient-vault';

describe('patient vault privacy lifecycle', () => {
  let fakeWindow: Window;
  let fakeDocument: Document;
  let curtain: Set<string>;
  let unlocked = true;

  beforeEach(() => {
    vi.useFakeTimers();
    unlocked = true;
    curtain = new Set<string>();
    fakeWindow = new EventTarget() as Window;
    fakeDocument = new EventTarget() as Document;
    Object.defineProperty(fakeDocument, 'visibilityState', {
      configurable: true,
      value: 'visible',
      writable: true,
    });
    Object.assign(fakeDocument, {
      documentElement: {
        classList: {
          add: (name: string) => curtain.add(name),
          remove: (name: string) => curtain.delete(name),
        },
      },
    });
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', fakeDocument);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the curtain through a hidden-tab five-minute lock until the UI clears its snapshot', () => {
    let lockCount = 0;
    const stop = installPatientVaultLifecycle(
      () => {
        lockCount += 1;
        unlocked = false;
        fakeWindow.dispatchEvent(new Event(PATIENT_VAULT_LOCK_EVENT));
      },
      () => unlocked,
    );

    (fakeDocument as unknown as { visibilityState: Document['visibilityState'] }).visibilityState =
      'hidden';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(curtain.has('patient-vault--privacy-curtain')).toBe(true);

    vi.advanceTimersByTime(5 * 60_000);
    expect(lockCount).toBe(1);
    expect(unlocked).toBe(false);
    expect(curtain.has('patient-vault--privacy-curtain')).toBe(true);

    fakeWindow.dispatchEvent(new Event(PATIENT_VAULT_UI_CLEARED_EVENT));
    expect(curtain.has('patient-vault--privacy-curtain')).toBe(true);

    (fakeDocument as unknown as { visibilityState: Document['visibilityState'] }).visibilityState =
      'visible';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(curtain.has('patient-vault--privacy-curtain')).toBe(false);
    stop();
  });

  it('does not run a second inactivity lock after pagehide clears the key', () => {
    let lockCount = 0;
    const stop = installPatientVaultLifecycle(
      () => {
        lockCount += 1;
        unlocked = false;
        fakeWindow.dispatchEvent(new Event(PATIENT_VAULT_LOCK_EVENT));
      },
      () => unlocked,
    );

    fakeWindow.dispatchEvent(new Event('pagehide'));
    expect(lockCount).toBe(1);
    expect(unlocked).toBe(false);
    expect(curtain.has('patient-vault--privacy-curtain')).toBe(true);

    vi.advanceTimersByTime(5 * 60_000);
    expect(lockCount).toBe(1);
    stop();
  });
});
