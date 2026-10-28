import type { PageHero } from '@/components/PageHero';

/**
 * The hero bands (components/PageHero.tsx) of the tabs, hubs, catalogs and lists, declared once and
 * rendered by the shared `Page`; the patient diary's tabs use the same. Readers, forms, editors and
 * tool workspaces keep a compact header.
 */
export const PAGE_HEROES = {
  search: { ambient: 'ecg' },
  news: { emblem: 'newspaper' },
  settings: { emblem: 'system' },
  assessments: { emblem: 'list-checks' },
  calculators: { emblem: 'calculator' },
  saved: { emblem: 'bookmark' },
  conditions: { emblem: 'heartbeat' },
  patients: { emblem: 'users' },
  forms: { emblem: 'file-text' },
  herbal: { emblem: 'leaf' },
  knowledge: { emblem: 'books' },
  library: { emblem: 'book-open' },
  files: { emblem: 'folder-open' },
  medications: { emblem: 'pill' },
  modules: { emblem: 'modules' },
  pubmed: { emblem: 'microscope' },
  newsSources: { emblem: 'rss' },
  notes: { emblem: 'notes' },
  diaryToday: { emblem: 'calendar', ambient: 'ecg' },
  diaryRecords: { emblem: 'check' },
  diarySend: { emblem: 'share' },
  diarySettings: { emblem: 'system' },
} as const satisfies Record<string, PageHero>;
