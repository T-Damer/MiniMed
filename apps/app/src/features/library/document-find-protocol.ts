import type {
  DocumentFindMatch,
  DocumentFindMode,
  DocumentFindUnit,
} from '@/features/library/document-find';

export type DocumentFindWorkerRequest =
  | { readonly id: number; readonly type: 'set-units'; readonly units: readonly DocumentFindUnit[] }
  | {
      readonly id: number;
      readonly type: 'find';
      readonly query: string;
      readonly mode: DocumentFindMode;
    };

export type DocumentFindWorkerResponse =
  | { readonly id: number; readonly matches: readonly DocumentFindMatch[] }
  | { readonly id: number; readonly error: string };
