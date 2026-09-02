export type NotesRoute =
  | { readonly kind: 'index' }
  | { readonly kind: 'patients' }
  | { readonly kind: 'new-patient' }
  | { readonly kind: 'patient'; readonly patientId: string; readonly episodeId?: string }
  | { readonly kind: 'patient-dynamics'; readonly patientId: string }
  | { readonly kind: 'templates'; readonly create?: boolean }
  | { readonly kind: 'template'; documentId: string }
  | { readonly kind: 'card'; readonly cardId: string }
  | { readonly kind: 'new-record'; readonly cardId: string }
  | { readonly kind: 'record'; readonly cardId: string; readonly noteId: string };

const FULLSCREEN_QUERY_KEY = 'fullscreen';
const CREATE_TEMPLATE_QUERY_KEY = 'create';
const PATIENT_EPISODE_QUERY_KEY = 'episode';

function notesPathAndQuery(hash: string): readonly [string, string] {
  const separator = hash.indexOf('?');
  return separator < 0 ? [hash, ''] : [hash.slice(0, separator), hash.slice(separator + 1)];
}

export function readNotesRoute(
  hash = typeof window === 'undefined' ? '' : window.location.hash,
): NotesRoute {
  const [path, query] = notesPathAndQuery(hash);
  const parts = path.replace(/^#\/?/u, '').split('/');
  if (parts[0] !== 'notes' || !parts[1]) return { kind: 'index' };
  if (parts[1] === 'patients') {
    if (parts.length === 2) return { kind: 'patients' };
    if (parts[2] === 'new') return { kind: 'new-patient' };
    if (!parts[2]) return { kind: 'patients' };
    let patientId: string;
    try {
      patientId = decodeURIComponent(parts[2]);
    } catch {
      return { kind: 'patients' };
    }
    const requestedEpisodeId = new URLSearchParams(query).get(PATIENT_EPISODE_QUERY_KEY);
    return parts[3] === 'dynamics' && parts.length === 4
      ? { kind: 'patient-dynamics', patientId }
      : parts.length === 3
        ? {
            kind: 'patient',
            patientId,
            ...(requestedEpisodeId ? { episodeId: requestedEpisodeId } : {}),
          }
        : { kind: 'patients' };
  }
  if (parts[1] === 'templates') {
    if (parts.length === 2) {
      return new URLSearchParams(query).get(CREATE_TEMPLATE_QUERY_KEY) === '1'
        ? { kind: 'templates', create: true }
        : { kind: 'templates' };
    }
    if (parts.length !== 3 || !parts[2]) return { kind: 'templates' };
    try {
      return { kind: 'template', documentId: decodeURIComponent(parts[2]) };
    } catch {
      return { kind: 'templates' };
    }
  }
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

export function notesPatientsPath(
  patientId?: string,
  dynamics = false,
  episodeId?: string,
): string {
  if (!patientId) return '#/notes/patients';
  const encoded = encodeURIComponent(patientId);
  if (dynamics) return `#/notes/patients/${encoded}/dynamics`;
  const episodeQuery = episodeId
    ? `?${PATIENT_EPISODE_QUERY_KEY}=${encodeURIComponent(episodeId)}`
    : '';
  return `#/notes/patients/${encoded}${episodeQuery}`;
}

export function notesNewPatientPath(): string {
  return '#/notes/patients/new';
}

export function notesTemplatesPath(create = false): string {
  return create ? '#/notes/templates?create=1' : '#/notes/templates';
}

export function noteTemplatePath(documentId: string): string {
  return `${notesTemplatesPath()}/${encodeURIComponent(documentId)}`;
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
