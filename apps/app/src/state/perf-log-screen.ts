/**
 * The screen name a performance-log entry carries: the address without its query and with every
 * segment that is not a fixed route word replaced by `:id`. A document id, a patient id, a user
 * file name or a search query therefore never reaches the log — only words like `notes/patients`.
 */
const ROUTE_WORDS = new Set([
  'a',
  'add',
  'ai',
  'appearance',
  'assessments',
  'atc',
  'calculators',
  'card',
  'category',
  'clinician',
  'collection',
  'conditions',
  'd',
  'data',
  'diaries',
  'documents',
  'downloads',
  'drug-comparison',
  'drug-interactions',
  'edit',
  'files',
  'forms',
  'general',
  'herbal',
  'icd11',
  'images',
  'laws',
  'medications',
  'mine',
  'modules',
  'new',
  'news',
  'notes',
  'patients',
  'prescription',
  'psy-status',
  'psychology',
  'read',
  'recommendations',
  'records',
  'reference',
  'regulatory',
  'results',
  'search',
  'section',
  'service',
  'settings',
  'skin-photo',
  'sources',
  'templates',
  'tools',
  'user',
  'vaccination',
  'worksheets',
]);

const MAX_SEGMENTS = 4;

export function screenOf(hash: string): string {
  const path = hash.replace(/^#\/?/u, '').split(/[?&]/u)[0] ?? '';
  if (!path) return 'home';
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment) continue;
    if (parts.length >= MAX_SEGMENTS) break;
    const word = ROUTE_WORDS.has(segment) ? segment : ':id';
    // `notes/:id/:id` → one `:id` per run of ids is enough to tell screens apart.
    if (word === ':id' && parts.at(-1) === ':id') continue;
    parts.push(word);
  }
  return parts.join('/') || 'home';
}
