import { describe, expect, it, vi } from 'vitest';

import { createLibraryDropHandlers, FOLDER_DRAG_TYPE } from '@/features/library/user-library-drag';

describe('user library drag and drop', () => {
  it('routes a dragged folder to the target folder', () => {
    const onMoveFolder = vi.fn();
    const onDrop = createLibraryDropHandlers({
      folderId: () => 'target-folder',
      onDragActive: vi.fn(),
      onDragEnd: vi.fn(),
      onDropFiles: vi.fn(),
      onMoveDocument: vi.fn(),
      onMoveFolder,
    }).onDrop;
    const event = {
      dataTransfer: {
        types: [FOLDER_DRAG_TYPE],
        files: [],
        getData: (type: string) => (type === FOLDER_DRAG_TYPE ? 'source-folder' : ''),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent;

    onDrop(event);

    expect(onMoveFolder).toHaveBeenCalledWith('source-folder', 'target-folder');
  });
});
