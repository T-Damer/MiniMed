import type { PageHero } from '@/components/PageHero';

/**
 * The hero bands (components/PageHero.tsx) of every `Page` route — tabs, hubs, catalogs, lists,
 * tools, forms and editors (owner 2026-10-29: one header design everywhere) — declared once and
 * rendered by the shared `Page`; the patient diary's tabs use the same. Readers keep their own
 * chrome.
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
  prescription: { emblem: 'prescription' },
  skinPhoto: { emblem: 'skin-layers' },
  comparison: { emblem: 'scales' },
  diaryToday: { emblem: 'calendar', ambient: 'ecg' },
  diaryRecords: { emblem: 'check' },
  diarySend: { emblem: 'share' },
  diarySettings: { emblem: 'system' },
  /** The diary's inner screens (a record, the install step): the band alone. */
  diaryInner: {},
} as const satisfies Record<string, PageHero>;
