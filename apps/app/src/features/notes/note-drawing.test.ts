import { describe, expect, it } from 'vitest';

import {
  createDrawingFile,
  createEmptyDrawing,
  drawingLinkCardSkeleton,
  drawingViewportCenter,
  isNoteDrawingFile,
  isSafeDrawingLink,
  NOTE_DRAWING_MIME,
  parseDrawingDocument,
  serializeDrawingDocument,
} from '@/features/notes/note-drawing';

function rectangle(link: unknown) {
  return {
    id: 'card',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0,
    opacity: 100,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 1,
    isDeleted: false,
    link,
  };
}

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

describe('drawing links and app cards', () => {
  it.each([null, undefined, '#/calculators/bmi', 'https://example.org/page'])(
    'accepts a safe element link %s',
    (link) => {
      expect(isSafeDrawingLink(link)).toBe(true);
      const scene = { ...createEmptyDrawing(), elements: [rectangle(link)] };
      expect(parseDrawingDocument(JSON.stringify(scene))).not.toBeNull();
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    '//evil.example/x',
    '#/notes/a b',
    'file:///etc/passwd',
    42,
  ])('rejects an imported scene whose element links to %s', (link) => {
    expect(isSafeDrawingLink(link)).toBe(false);
    const scene = { ...createEmptyDrawing(), elements: [rectangle(link)] };
    expect(parseDrawingDocument(JSON.stringify(scene))).toBeNull();
  });

  it('centres a labelled card on the visible canvas and links only inside MiniMed', () => {
    const center = drawingViewportCenter({
      scrollX: -100,
      scrollY: 50,
      width: 800,
      height: 600,
      zoom: { value: 2 },
    });
    expect(center).toEqual({ x: 300, y: 100 });
    const card = drawingLinkCardSkeleton(
      { kindLabel: 'Калькулятор', title: 'Индекс массы тела', route: '#/calculators/bmi' },
      center,
    );
    expect(card).toMatchObject({
      type: 'rectangle',
      x: 160,
      y: 52,
      link: '#/calculators/bmi',
      label: { text: 'Калькулятор\nИндекс массы тела' },
    });
    expect(() =>
      drawingLinkCardSkeleton({ kindLabel: 'x', title: 'x', route: 'https://a.example' }, center),
    ).toThrow('inside MiniMed');
  });
});
