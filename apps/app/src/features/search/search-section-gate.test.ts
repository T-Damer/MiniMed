import { describe, expect, it } from 'vitest';

import type { SearchCoreStatus } from '@/features/search/search-core-status';
import { SEARCH_SCOPES } from '@/features/search/search-scopes';
import {
  scopeNeedsCore,
  sectionGate,
  sectionWaitMark,
  sectionWaitMessage,
} from './search-section-gate';

const downloading: SearchCoreStatus = { kind: 'downloading', loaded: 2_800_000, total: 72_000_000 };

describe('section gate', () => {
  it('opens every section once the core is ready', () => {
    for (const scope of SEARCH_SCOPES)
      expect(sectionGate(scope, undefined)).toEqual({ allowed: true });
  });

  it('keeps the document sections shut while the core downloads', () => {
    for (const scope of [
      'medications',
      'guidelines',
      'conditions',
      'icd11',
      'legal',
      'diagnosis',
    ] as const) {
      expect(sectionGate(scope, downloading)).toEqual({
        allowed: false,
        message: 'Загружаем ядро знаний, подождите',
      });
    }
  });

  it('leaves the tool sections and the section list open without the core', () => {
    for (const scope of ['all', 'calculators', 'assessments', 'personal'] as const) {
      expect(scopeNeedsCore(scope)).toBe(false);
      expect(sectionGate(scope, downloading)).toEqual({ allowed: true });
    }
  });

  it('names what the core is doing', () => {
    expect(sectionWaitMessage({ kind: 'opening', slow: true })).toBe(
      'Загружаем ядро знаний, подождите',
    );
    expect(sectionWaitMessage({ kind: 'verifying' })).toBe('Загружаем ядро знаний, подождите');
    expect(sectionWaitMessage({ kind: 'waiting' })).toBe('Ядро знаний ещё не загружено');
    expect(sectionWaitMessage({ kind: 'offline' })).toContain('Нет сети');
    expect(sectionWaitMessage({ kind: 'error', message: 'x' })).toBe('Ядро знаний не открылось');
  });

  it('marks the loading state with the real download share', () => {
    expect(sectionWaitMark(downloading)).toEqual({
      state: 'running',
      progress: 2_800_000 / 72_000_000,
      busy: false,
    });
    expect(sectionWaitMark({ kind: 'verifying' })).toEqual({
      state: 'running',
      progress: null,
      busy: true,
    });
    expect(sectionWaitMark(undefined).busy).toBe(true);
    expect(sectionWaitMark({ kind: 'error', message: 'x' }).state).toBe('failed');
    expect(sectionWaitMark({ kind: 'waiting' }).state).toBe('queued');
  });
});
