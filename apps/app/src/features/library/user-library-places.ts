import type { AppGlyphName } from '@/components/AppGlyph';
import type { ListTileTone } from '@/components/ListRow';
import { USER_LIBRARY_CATALOG_HASH } from '@/features/library/user-library-routing';
import type { UserLibraryFileKind } from '@/state/user-library-capabilities';

/**
 * «Файлы» by what a file is (owner 2026-11-11): sections that gather every file of one kind from
 * all folders, and «Мой компьютер», the device's own files. Declared here, drawn by the page
 * (AGENTS.md «Schema first»).
 */

export type UserLibraryKindGroupId =
  | 'documents'
  | 'images'
  | 'video'
  | 'audio'
  | 'books'
  | 'tables'
  | 'questionnaires'
  | 'other';

export interface UserLibraryKindGroup {
  readonly id: UserLibraryKindGroupId;
  readonly title: string;
  /** What falls into it, for the row's quiet line. */
  readonly hint: string;
  readonly icon: AppGlyphName;
  readonly tone: ListTileTone;
  readonly kinds: readonly UserLibraryFileKind[];
}

export const USER_LIBRARY_KIND_GROUPS: readonly UserLibraryKindGroup[] = [
  {
    id: 'documents',
    title: 'Документы',
    hint: 'PDF, Word, текст',
    icon: 'file-text',
    tone: 'blue',
    kinds: ['pdf', 'doc', 'text'],
  },
  {
    id: 'images',
    title: 'Изображения и снимки',
    hint: 'Фото, сканы, DICOM',
    icon: 'image',
    tone: 'teal',
    kinds: ['image', 'dicom', 'volume'],
  },
  { id: 'video', title: 'Видео', hint: '', icon: 'film-slate', tone: 'purple', kinds: ['video'] },
  { id: 'audio', title: 'Аудио', hint: '', icon: 'music-notes', tone: 'pink', kinds: ['audio'] },
  {
    id: 'books',
    title: 'Книги',
    hint: 'EPUB, FB2',
    icon: 'book-open',
    tone: 'orange',
    kinds: ['ebook'],
  },
  {
    id: 'tables',
    title: 'Таблицы и презентации',
    hint: '',
    icon: 'file-xls',
    tone: 'green',
    kinds: ['sheet', 'presentation'],
  },
  {
    id: 'questionnaires',
    title: 'Анкеты',
    hint: '',
    icon: 'list-checks',
    tone: 'green',
    kinds: ['questionnaire'],
  },
  {
    id: 'other',
    title: 'Прочее',
    hint: 'Архивы, код, другие файлы',
    icon: 'file-zip',
    tone: 'gray',
    kinds: ['archive', 'code', 'binary'],
  },
];

const GROUP_BY_KIND = new Map<UserLibraryFileKind, UserLibraryKindGroup>(
  USER_LIBRARY_KIND_GROUPS.flatMap((group) => group.kinds.map((kind) => [kind, group] as const)),
);

export function userLibraryKindGroup(kind: UserLibraryFileKind): UserLibraryKindGroup {
  const group = GROUP_BY_KIND.get(kind);
  if (!group) throw new Error(`File kind ${kind} has no section.`);
  return group;
}

export function userLibraryKindGroupById(id: string | null): UserLibraryKindGroup | undefined {
  return USER_LIBRARY_KIND_GROUPS.find((group) => group.id === id);
}

/** How many files each section holds; sections with none are left out, in the declared order. */
export function userLibraryKindCounts(
  kinds: Iterable<UserLibraryFileKind>,
): readonly { readonly group: UserLibraryKindGroup; readonly count: number }[] {
  const counts = new Map<UserLibraryKindGroupId, number>();
  for (const kind of kinds) {
    const id = userLibraryKindGroup(kind).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return USER_LIBRARY_KIND_GROUPS.filter((group) => (counts.get(group.id) ?? 0) > 0).map(
    (group) => ({ group, count: counts.get(group.id) ?? 0 }),
  );
}

/** The place a «Файлы» address shows: the folder tree, one kind from all folders, or the computer. */
export type UserLibraryPlace =
  | { readonly kind: 'folders' }
  | { readonly kind: 'kind'; readonly group: UserLibraryKindGroupId }
  | { readonly kind: 'computer' };

const QUERY_PREFIX = 'modules/documents/user?';

export function parseUserLibraryPlace(route: string): UserLibraryPlace {
  if (!route.startsWith(QUERY_PREFIX)) return { kind: 'folders' };
  const query = new URLSearchParams(route.slice(QUERY_PREFIX.length));
  if (query.get('place') === 'computer') return { kind: 'computer' };
  const group = userLibraryKindGroupById(query.get('kind'));
  return group ? { kind: 'kind', group: group.id } : { kind: 'folders' };
}

export function userLibraryPlaceHash(place: UserLibraryPlace): string {
  if (place.kind === 'computer') return `${USER_LIBRARY_CATALOG_HASH}?place=computer`;
  if (place.kind === 'kind') return `${USER_LIBRARY_CATALOG_HASH}?kind=${place.group}`;
  return USER_LIBRARY_CATALOG_HASH;
}
