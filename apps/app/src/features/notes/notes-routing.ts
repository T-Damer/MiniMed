export type NotesRoute =
  | { readonly kind: 'index' }
  | { readonly kind: 'card'; readonly cardId: string }
  | { readonly kind: 'new-record'; readonly cardId: string }
  | { readonly kind: 'record'; readonly cardId: string; readonly noteId: string };

const FULLSCREEN_QUERY_KEY = 'fullscreen';

function notesPathAndQuery(hash: string): readonly [string, string] {
  const separator = hash.indexOf('?');
  return separator < 0 ? [hash, ''] : [hash.slice(0, separator), hash.slice(separator + 1)];
}

export function readNotesRoute(
  hash = typeof window === 'undefined' ? '' : window.location.hash,
): NotesRoute {
  const [path] = notesPathAndQuery(hash);
  const parts = path.replace(/^#\/?/u, '').split('/');
  if (parts[0] !== 'notes' || !parts[1]) return { kind: 'index' };
  let cardId: string;
  try {
    cardId = decodeURIComponent(parts[1]);
  } catch {
    return { kind: 'index' };
  }
  if (parts.length === 2) return { kind: 'card', cardId };
  if (parts[2] !== 'records' || !parts[3]) return { kind: 'card', cardId };
  if (parts[3] === 'new') return { kind: 'new-record', cardId };
  try {
    return { kind: 'record', cardId, noteId: decodeURIComponent(parts[3]) };
  } catch {
    return { kind: 'card', cardId };
  }
}

export function notesPath(cardId?: string, noteId?: string): string {
  if (!cardId) return '#/notes';
  const card = encodeURIComponent(cardId);
  if (!noteId) return `#/notes/${card}`;
  return `#/notes/${card}/records/${encodeURIComponent(noteId)}`;
}

export function isNotesFullscreenRoute(
  hash = typeof window === 'undefined' ? '' : window.location.hash,
): boolean {
  const [path, query] = notesPathAndQuery(hash);
  if (!path.startsWith('#/notes/')) return false;
  return new URLSearchParams(query).get(FULLSCREEN_QUERY_KEY) === '1';
}

export function withNotesFullscreen(hash: string, fullscreen: boolean): string {
  const [path, query] = notesPathAndQuery(hash);
  if (!path.startsWith('#/notes/')) return hash;
  const params = new URLSearchParams(query);
  if (fullscreen) params.set(FULLSCREEN_QUERY_KEY, '1');
  else params.delete(FULLSCREEN_QUERY_KEY);
  const nextQuery = params.toString();
  return nextQuery ? `${path}?${nextQuery}` : path;
}
