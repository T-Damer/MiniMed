export const CONTENT_SCHEMA_VERSION = 2;

export const SECTION_TYPES = [
  'definition',
  'classification',
  'clinical-picture',
  'diagnostics',
  'differential-diagnosis',
  'treatment',
  'routing',
  'prevention',
  'rehabilitation',
  'other',
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];
