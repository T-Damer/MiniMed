import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearFormSessions,
  type FormDraft,
  formSessionKey,
  readFormSession,
  writeFormSession,
} from '@/features/forms/form-session';
import { PATIENT_VAULT_LOCK_EVENT } from '@/state/patient-vault';

const draft: FormDraft = {
  edits: { organisation: 'ГБУЗ Тест' },
  status: 'draft',
  updatedAt: '2026-10-13T10:00:00.000Z',
};

const windowEvents = new EventTarget();
vi.stubGlobal('window', windowEvents);

beforeEach(() => clearFormSessions());

describe('drafts kept in memory', () => {
  it('survive until the vault locks, not merely until a screen is mounted again', () => {
    const key = formSessionKey('form', undefined, undefined);
    writeFormSession(key, draft);
    expect(readFormSession(key)).toEqual(draft);
    windowEvents.dispatchEvent(new Event(PATIENT_VAULT_LOCK_EVENT));
    expect(readFormSession(key)).toBeUndefined();
  });

  it('forget an untouched draft', () => {
    const key = formSessionKey('form', 'p1', 'e1');
    writeFormSession(key, draft);
    writeFormSession(key, { ...draft, edits: {} });
    expect(readFormSession(key)).toBeUndefined();
  });
});
