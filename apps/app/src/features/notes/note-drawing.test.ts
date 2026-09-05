import { describe, expect, it } from 'vitest';

import {
  createDrawingFile,
  createEmptyDrawing,
  isNoteDrawingFile,
  NOTE_DRAWING_MIME,
  parseDrawingDocument,
  serializeDrawingDocument,
} from '@/features/notes/note-drawing';

describe('Excalidraw note attachment format', () => {
  it('round-trips an editable empty scene', () => {
    const drawing = createEmptyDrawing();
    expect(parseDrawingDocument(serializeDrawingDocument(drawing))).toEqual(drawing);
  });

  it('rejects legacy and malformed scene payloads', () => {
    expect(parseDrawingDocument('{"schema":"minimed-drawing","version":1}')).toBeNull();
    expect(
      parseDrawingDocument(
        JSON.stringify({ ...createEmptyDrawing(), elements: [{ type: 'iframe' }] }),
      ),
    ).toBeNull();
  });

  it('creates a portable Excalidraw attachment', async () => {
    const file = createDrawingFile(createEmptyDrawing(), 'flow.excalidraw.json');
    expect(file.type).toBe(NOTE_DRAWING_MIME);
    expect(isNoteDrawingFile(file)).toBe(true);
    expect(parseDrawingDocument(await file.text())).toEqual(createEmptyDrawing());
  });
});
