import { describe, expect, it } from 'vitest';

import {
  compactBreadcrumbItems,
  documentTrailBreadcrumbItems,
} from '@/components/app-breadcrumb-items';
import type { DocumentTrail } from '@/state/document-trail';

const origin = { hash: '#/search', search: '', label: 'Поиск', view: 'search' } as const;

describe('documentTrailBreadcrumbItems', () => {
  it('links the origin and earlier documents and leaves the last crumb as the current page', () => {
    const trail: DocumentTrail = {
      origin,
      crumbs: [
        { kind: 'official', id: 'a', title: 'А', href: '#/a' },
        { kind: 'official', id: 'b', title: 'Б', href: '#/b' },
      ],
    };
    expect(documentTrailBreadcrumbItems(trail)).toEqual([
      { label: 'Поиск', href: '#/search' },
      { label: 'А', href: '#/a' },
      { label: 'Б' },
    ]);
  });
});

describe('documentTrailBreadcrumbItems: one crumb per document', () => {
  it('drops a module pointer once the installed document that replaced it is in the trail', () => {
    const trail: DocumentTrail = {
      origin,
      crumbs: [
        {
          kind: 'official',
          id: 'core.catalog.pointer.clinical.kr.rf.1006_1-1151be108d81d0ac',
          title: 'Острая ишемия конечностей (краткая справка)',
          href: '#/pointer',
        },
        {
          kind: 'official',
          id: 'kr.rf.1006_1',
          title: 'Острая ишемия конечностей',
          href: '#/full',
        },
      ],
    };
    expect(documentTrailBreadcrumbItems(trail)).toEqual([
      { label: 'Поиск', href: '#/search' },
      { label: 'Острая ишемия конечностей' },
    ]);
  });

  it('drops a summary when its full text is a later crumb, whatever the titles say', () => {
    const trail: DocumentTrail = {
      origin,
      crumbs: [
        { kind: 'official', id: 'kr.rf.281_3', title: 'ИМП', href: '#/summary' },
        {
          kind: 'official',
          id: 'kr.rf.281_3.full',
          title: 'Инфекция мочевых путей',
          href: '#/full',
        },
      ],
    };
    expect(documentTrailBreadcrumbItems(trail).map((item) => item.label)).toEqual([
      'Поиск',
      'Инфекция мочевых путей',
    ]);
  });

  it('keeps different documents, and a personal file next to an official one', () => {
    const trail: DocumentTrail = {
      origin,
      crumbs: [
        { kind: 'official', id: 'esklp.mnn.албендазол', title: 'Албендазол', href: '#/card' },
        { kind: 'official', id: 'esklp.instruction.1', title: 'Инструкция', href: '#/instruction' },
        { kind: 'user', id: 'user-1', title: 'Мой файл', href: '#/user' },
      ],
    };
    expect(documentTrailBreadcrumbItems(trail).map((item) => item.label)).toEqual([
      'Поиск',
      'Албендазол',
      'Инструкция',
      'Мой файл',
    ]);
  });
});

describe('compactBreadcrumbItems', () => {
  it('drops the last crumb that repeats the page heading and keeps every other crumb a link', () => {
    const result = compactBreadcrumbItems(
      [{ label: 'Поиск', href: '#/search' }, { label: 'Пневмония (внебольничная)' }],
      'Пневмония (внебольничная)',
    );
    expect(result).toEqual({ items: [{ label: 'Поиск', href: '#/search' }], allLinks: true });
  });

  it('collapses a pointer and its installed document into one crumb before comparing', () => {
    const result = compactBreadcrumbItems(
      [
        { label: 'Поиск', href: '#/search' },
        { label: 'Острая ишемия конечностей', href: '#/pointer' },
        { label: 'Острая  ишемия конечностей' },
      ],
      'Острая ишемия конечностей',
    );
    expect(result.items.map((item) => item.label)).toEqual(['Поиск']);
    expect(result.allLinks).toBe(true);
  });

  it('keeps an earlier different document as the context', () => {
    const result = compactBreadcrumbItems(
      [
        { label: 'Поиск', href: '#/search' },
        { label: 'Препарат', href: '#/drug' },
        { label: 'Инструкция' },
      ],
      'Инструкция',
    );
    expect(result.items.map((item) => item.label)).toEqual(['Поиск', 'Препарат']);
    expect(result.allLinks).toBe(true);
  });

  it('keeps the current crumb while the page heading is not shown or differs', () => {
    const items = [{ label: 'Поиск', href: '#/search' }, { label: 'Документ' }];
    expect(compactBreadcrumbItems(items, null)).toEqual({ items, allLinks: false });
    expect(compactBreadcrumbItems(items, 'Другой заголовок')).toEqual({ items, allLinks: false });
  });

  it('never empties the trail', () => {
    const items = [{ label: 'Документ' }];
    expect(compactBreadcrumbItems(items, 'Документ')).toEqual({ items, allLinks: false });
  });
});
