import { describe, expect, it } from 'vitest';

import {
  isNotesFullscreenRoute,
  notesPath,
  readNotesRoute,
  withNotesFullscreen,
} from '@/features/notes/notes-routing';

describe('notes routing', () => {
  it('parses index, card, new-record, and record routes', () => {
    expect(readNotesRoute('#/notes')).toEqual({ kind: 'index' });
    expect(readNotesRoute('#/notes/card%2F1')).toEqual({
      kind: 'card',
      cardId: 'card/1',
    });
    expect(readNotesRoute('#/notes/card-1/records/new')).toEqual({
      kind: 'new-record',
      cardId: 'card-1',
    });
    expect(readNotesRoute('#/notes/card-1/records/note%2F1')).toEqual({
      kind: 'record',
      cardId: 'card-1',
      noteId: 'note/1',
    });
    expect(readNotesRoute('#/notes/card-1/records/note-1?fullscreen=1')).toEqual({
      kind: 'record',
      cardId: 'card-1',
      noteId: 'note-1',
    });
  });

  it('falls back safely for malformed or incomplete routes', () => {
    expect(readNotesRoute('#/search')).toEqual({ kind: 'index' });
    expect(readNotesRoute('#/notes/card-1/other')).toEqual({
      kind: 'card',
      cardId: 'card-1',
    });
    expect(readNotesRoute('#/notes/%')).toEqual({ kind: 'index' });
  });

  it('builds encoded notes paths', () => {
    expect(notesPath()).toBe('#/notes');
    expect(notesPath('card/1')).toBe('#/notes/card%2F1');
    expect(notesPath('card/1', 'note/1')).toBe('#/notes/card%2F1/records/note%2F1');
  });

  it('round-trips the fullscreen editor flag without changing the note route', () => {
    const path = notesPath('card-1', 'note-1');
    const fullscreenPath = withNotesFullscreen(path, true);
    expect(fullscreenPath).toBe(`${path}?fullscreen=1`);
    expect(isNotesFullscreenRoute(fullscreenPath)).toBe(true);
    expect(withNotesFullscreen(fullscreenPath, false)).toBe(path);
  });
});
