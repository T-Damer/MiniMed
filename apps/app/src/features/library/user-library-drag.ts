export const DOCUMENT_DRAG_TYPE = 'application/x-minimed-document-id';
export const FOLDER_DRAG_TYPE = 'application/x-minimed-folder-id';

export function draggedDocumentId(event: DragEvent): string | null {
  return event.dataTransfer?.getData(DOCUMENT_DRAG_TYPE) || null;
}

export function draggedFolderId(event: DragEvent): string | null {
  return event.dataTransfer?.getData(FOLDER_DRAG_TYPE) || null;
}

export function hasFileTransfer(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

function acceptsLibraryDrop(event: DragEvent): boolean {
  return (
    hasFileTransfer(event) ||
    event.dataTransfer?.types.includes(DOCUMENT_DRAG_TYPE) ||
    event.dataTransfer?.types.includes(FOLDER_DRAG_TYPE) ||
    false
  );
}

interface LibraryDropOptions {
  /** Folder the dropped content lands in (`null` = library root). */
  readonly folderId: () => string | null;
  readonly onDragActive: (folderId: string | null) => void;
  readonly onDragEnd: () => void;
  readonly onDropFiles: (files: FileList | null | undefined, folderId: string | null) => void;
  readonly onMoveDocument: (documentId: string, folderId: string | null) => void;
  readonly onMoveFolder: (folderId: string, parentId: string | null) => void;
}

/**
 * Shared drop-target wiring for folders, breadcrumbs, and the page root:
 * highlights while any library-accepted transfer hovers and routes the drop
 * to files-upload or document-move.
 */
export function createLibraryDropHandlers(options: LibraryDropOptions) {
  let depth = 0;
  const setTarget = (): void => options.onDragActive(options.folderId());
  return {
    onDragEnter: (event: DragEvent): void => {
      if (!acceptsLibraryDrop(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth += 1;
      setTarget();
    },
    onDragOver: (event: DragEvent): void => {
      if (!acceptsLibraryDrop(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget();
    },
    onDragLeave: (event: DragEvent): void => {
      const element = event.currentTarget;
      if (
        depth > 0 &&
        !(
          element instanceof HTMLElement &&
          event.relatedTarget instanceof Node &&
          element.contains(event.relatedTarget)
        )
      ) {
        depth = Math.max(0, depth - 1);
        if (depth === 0) options.onDragEnd();
      }
    },
    onDrop: (event: DragEvent): void => {
      if (!acceptsLibraryDrop(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      const folderId = options.folderId();
      options.onDragEnd();
      const draggedFolder = draggedFolderId(event);
      if (draggedFolder) {
        options.onMoveFolder(draggedFolder, folderId);
        return;
      }
      const documentId = draggedDocumentId(event);
      if (documentId) options.onMoveDocument(documentId, folderId);
      else options.onDropFiles(event.dataTransfer?.files, folderId);
    },
  };
}
