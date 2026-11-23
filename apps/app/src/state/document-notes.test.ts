import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearMemoryDocumentNotesForTests,
  loadDocumentNote,
  saveDocumentNote,
} from '@/state/document-notes';

describe('document-notes', () => {
  beforeEach(() => {
    clearMemoryDocumentNotesForTests();
  });

  it('saves, loads, updates, and clears a document note', async () => {
    expect(await loadDocumentNote('kr.rf.507_4')).toBeNull();

    const saved = await saveDocumentNote('kr.rf.507_4', '  Контроль QT через 2 недели  ');
    expect(saved?.text).toBe('Контроль QT через 2 недели');
    expect((await loadDocumentNote('kr.rf.507_4'))?.text).toBe('Контроль QT через 2 недели');

    const cleared = await saveDocumentNote('kr.rf.507_4', '   ');
    expect(cleared).toBeNull();
    expect(await loadDocumentNote('kr.rf.507_4')).toBeNull();
  });
});
