import { describe, expect, it } from 'vitest';
import {
  buildClinicalEditionIndex,
  clinicalEditionIdFromDocumentId,
  clinicalEditionIndex,
  clinicalEditionNotice,
  currentEditionLink,
  formatEditionDate,
  isSupersededClinicalModule,
  listableModules,
  supersededEditionNote,
  withoutOlderEditions,
} from '@/features/modules/clinical-editions';

const edition = (
  id: string,
  version: number,
  status: 'active' | 'superseded',
  publishedAt: string,
  moduleId: string | null,
) => ({
  id,
  version,
  status,
  publishedAt,
  replacedBy: null,
  moduleId,
});

const synthetic = buildClinicalEditionIndex({
  codes: [
    {
      code: 9,
      title: 'Тест',
      editions: [
        edition('9_3', 3, 'active', '2026-03-12T10:00:00', 'm.9_3'),
        edition('9_1', 1, 'superseded', '2020-01-05T00:00:00', null),
        edition('9_2', 2, 'superseded', '2023-12-31T23:59:59', 'm.9_2'),
      ],
    },
  ],
});

describe('Russian edition dates', () => {
  it('formats the calendar date as written, without a time zone shift', () => {
    expect(formatEditionDate('2025-03-12T00:00:00')).toBe('12 марта 2025');
    expect(formatEditionDate('2023-12-31T23:59:59')).toBe('31 декабря 2023');
    expect(formatEditionDate('2020-01-05T00:00:00')).toBe('5 января 2020');
  });

  it('does not invent a date', () => {
    expect(formatEditionDate('')).toBe('даты нет в реестре');
    expect(formatEditionDate('2025-13-01')).toBe('даты нет в реестре');
  });
});

describe('edition ids', () => {
  it('reads the edition from a КР document id and ignores other documents', () => {
    expect(clinicalEditionIdFromDocumentId('kr.rf.507_4')).toBe('507_4');
    expect(clinicalEditionIdFromDocumentId('kr.rf.507_4.summary')).toBe('507_4');
    expect(clinicalEditionIdFromDocumentId('kr.rf.507_41')).toBe('507_41');
    expect(clinicalEditionIdFromDocumentId('esklp.mnn.1')).toBeNull();
    expect(clinicalEditionIdFromDocumentId('kr.rf.')).toBeNull();
  });
});

describe('which editions are listed', () => {
  const modules = [{ id: 'm.9_1' }, { id: 'm.9_2' }, { id: 'm.9_3' }, { id: 'unrelated' }];

  it('hides a replaced edition unless it is installed', () => {
    expect(listableModules(modules, new Set(), synthetic).map((m) => m.id)).toEqual([
      'm.9_1',
      'm.9_3',
      'unrelated',
    ]);
    expect(isSupersededClinicalModule('m.9_2', synthetic)).toBe(true);
    expect(isSupersededClinicalModule('m.9_3', synthetic)).toBe(false);
  });

  it('keeps an installed replaced edition and leaves unknown modules alone', () => {
    expect(listableModules(modules, new Set(['m.9_2']), synthetic).map((m) => m.id)).toContain(
      'm.9_2',
    );
  });

  it('never drops a module that the sidecar does not know', () => {
    expect(listableModules([{ id: 'x' }], new Set(), synthetic)).toHaveLength(1);
  });
});

describe('the notice above an open recommendation', () => {
  it('points a current edition at the immediately previous one', () => {
    const notice = clinicalEditionNotice('kr.rf.9_3', synthetic);
    expect(notice?.kind).toBe('current');
    expect(notice?.lead).toBe('Это новая редакция от 12 марта 2026.');
    expect(notice?.action?.label).toBe('Открыть старую редакцию от 31 декабря 2023');
    expect(notice?.action?.target).toMatchObject({
      editionId: '9_2',
      moduleId: 'm.9_2',
      documentId: 'kr.rf.9_2',
    });
  });

  it('points any replaced edition at the newest one', () => {
    for (const id of ['9_1', '9_2']) {
      const notice = clinicalEditionNotice(`kr.rf.${id}`, synthetic);
      expect(notice?.kind).toBe('replaced');
      expect(notice?.action?.label).toBe('Открыть новую редакцию от 12 марта 2026');
      expect(notice?.action?.target.editionId).toBe('9_3');
    }
    expect(clinicalEditionNotice('kr.rf.9_2', synthetic)?.lead).toBe(
      'Это старая редакция от 31 декабря 2023.',
    );
  });

  it('says nothing when the previous edition is not shipped', () => {
    const only = buildClinicalEditionIndex({
      codes: [
        {
          code: 4,
          title: 'Тест',
          editions: [
            edition('4_1', 1, 'superseded', '2020-02-02T00:00:00', null),
            edition('4_2', 2, 'active', '2025-05-05T00:00:00', 'm.4_2'),
          ],
        },
      ],
    });
    expect(clinicalEditionNotice('kr.rf.4_2', only)).toBeNull();
  });

  it('shows nothing for a recommendation without other editions or a non-КР document', () => {
    expect(clinicalEditionNotice('kr.rf.1000_1', synthetic)).toBeNull();
    expect(clinicalEditionNotice('esklp.mnn.5', synthetic)).toBeNull();
  });
});

describe('real edition chains (catalog.clinical-editions.json)', () => {
  it('lists 507_4 and hides the replaced 507_3 until it is installed', () => {
    const modules = [
      { id: 'minimed.clinical.recommendation.507_3' },
      { id: 'minimed.clinical.recommendation.507_4' },
    ];
    expect(listableModules(modules, new Set()).map((m) => m.id)).toEqual([
      'minimed.clinical.recommendation.507_4',
    ]);
    expect(
      listableModules(modules, new Set(['minimed.clinical.recommendation.507_3'])),
    ).toHaveLength(2);
  });

  it('gives the installed 507_3 its badge and the link to 507_4', () => {
    const note = supersededEditionNote('minimed.clinical.recommendation.507_3');
    expect(note?.badge).toBe('прежняя редакция');
    expect(note?.linkLabel).toBe('Текущая редакция от 14 августа 2026');
    expect(note?.target.documentId).toBe('kr.rf.507_4');
    expect(currentEditionLink('minimed.clinical.recommendation.507_4')).toBeNull();
  });

  it('writes both reader notices for 507_4 and 507_3 with the registry dates', () => {
    expect(clinicalEditionNotice('kr.rf.507_4')?.lead).toBe(
      'Это новая редакция от 14 августа 2026.',
    );
    expect(clinicalEditionNotice('kr.rf.507_4')?.action?.label).toBe(
      'Открыть старую редакцию от 18 сентября 2024',
    );
    expect(clinicalEditionNotice('kr.rf.507_3')?.action?.label).toBe(
      'Открыть новую редакцию от 14 августа 2026',
    );
  });

  it('only ever links to editions whose module is in the catalog or says it is not shipped', () => {
    const index = clinicalEditionIndex();
    for (const [editionId] of index.chains) {
      const notice = clinicalEditionNotice(`kr.rf.${editionId}`, index);
      if (!notice) continue;
      expect(notice.action.target.moduleId).not.toBeNull();
    }
  });
});

describe('withoutOlderEditions', () => {
  const index = buildClinicalEditionIndex({
    codes: [
      {
        code: 507,
        title: 'Туберкулез у детей',
        editions: [
          edition('507_3', 3, 'superseded', '2022-01-10T00:00:00', 'm.507_3'),
          edition('507_4', 4, 'active', '2026-09-01T00:00:00', 'm.507_4'),
        ],
      },
    ],
  });
  const results = (...ids: string[]) => ids.map((id) => ({ id }));
  const byId = (item: { readonly id: string }) => clinicalEditionIdFromDocumentId(item.id);

  it('keeps only the newest edition of a chain found together', () => {
    expect(
      withoutOlderEditions(results('kr.rf.507_3', 'icd.a15', 'kr.rf.507_4'), byId, index),
    ).toEqual(results('icd.a15', 'kr.rf.507_4'));
  });

  it('keeps an older edition found on its own and leaves other documents alone', () => {
    expect(withoutOlderEditions(results('kr.rf.507_3', 'icd.a15'), byId, index)).toEqual(
      results('kr.rf.507_3', 'icd.a15'),
    );
    expect(withoutOlderEditions(results('kr.rf.999_1'), byId, index)).toEqual(
      results('kr.rf.999_1'),
    );
  });
});
