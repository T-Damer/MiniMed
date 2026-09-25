import type { NoteFile } from '@/state/note-files';
import { noteFileSrc } from '@/state/note-files';
import { attachmentViewerKind } from '@/state/thumbnails';

export type ViewerState =
  | { readonly kind: 'image'; readonly name: string; readonly src: string }
  | {
      readonly kind: 'video';
      readonly name: string;
      readonly src: string;
      readonly poster?: string;
    }
  | {
      readonly kind: 'audio';
      readonly name: string;
      readonly src: string;
      readonly record: NoteFile;
    }
  | {
      readonly kind: 'text';
      readonly name: string;
      readonly mimeType?: string;
      readonly blob: Blob;
    }
  | { readonly kind: 'pdf'; readonly name: string; readonly record: NoteFile }
  | { readonly kind: 'download'; readonly name: string; readonly record: NoteFile };

export function recordToViewerState(record: NoteFile): ViewerState {
  const kind = attachmentViewerKind(record.mimeType);
  if (kind === 'image') {
    return {
      kind: 'image',
      name: record.name,
      src: record.thumbnailDataUrl ?? noteFileSrc(record),
    };
  }
  if (kind === 'video') {
    return {
      kind,
      name: record.name,
      src: noteFileSrc(record),
      ...(record.thumbnailDataUrl ? { poster: record.thumbnailDataUrl } : {}),
    };
  }
  if (kind === 'audio') {
    return {
      kind,
      name: record.name,
      src: noteFileSrc(record),
      record,
    };
  }
  if (kind === 'text') {
    return { kind: 'text', name: record.name, mimeType: record.mimeType, blob: record.blob };
  }
  return { kind: 'pdf', name: record.name, record };
}
