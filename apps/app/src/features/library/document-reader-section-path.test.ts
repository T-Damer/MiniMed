import { describe, expect, it } from 'vitest';
import {
  pickStuckHeadingIndex,
  sameTitlePath,
  sectionPathLabel,
  sectionTitlePath,
} from '@/features/library/document-reader-section-path';

const heading = (top: number, visible = true): HTMLElement =>
  ({
    getBoundingClientRect: () => ({ top }),
    checkVisibility: () => visible,
  }) as unknown as HTMLElement;

describe('pickStuckHeadingIndex', () => {
  it('is the deepest heading above the line, and -1 before the first one', () => {
    const headings = [heading(-300), heading(-120), heading(-10), heading(90), heading(400)];
    expect(pickStuckHeadingIndex(headings, 60)).toBe(2);
    expect(pickStuckHeadingIndex(headings, 95)).toBe(3);
    expect(pickStuckHeadingIndex([heading(80), heading(200)], 60)).toBe(-1);
    expect(pickStuckHeadingIndex([], 60)).toBe(-1);
  });

  it('ignores headings the browser skips, whose boxes are stale', () => {
    const headings = [heading(-500), heading(900, false), heading(-20), heading(300)];
    expect(pickStuckHeadingIndex(headings, 60)).toBe(2);
  });
});

interface FakeSection {
  readonly title: string;
  readonly parent: FakeSection | null;
}

function fakeHeading(section: FakeSection): HTMLElement {
  const sectionElement = (value: FakeSection): HTMLElement =>
    ({
      querySelector: () => ({ textContent: `  ${value.title}\n` }),
      parentElement: value.parent
        ? { closest: () => sectionElement(value.parent as FakeSection) }
        : { closest: () => null },
    }) as unknown as HTMLElement;
  return { closest: () => sectionElement(section) } as unknown as HTMLElement;
}

describe('sectionTitlePath', () => {
  it('lists the section titles outermost first with the whitespace collapsed', () => {
    const treatment = { title: '3. Лечение', parent: null };
    const therapy = { title: '3.1 Купирующая  терапия', parent: treatment };
    const step = { title: '3.1.4 Тяжёлая степень', parent: therapy };
    expect(sectionTitlePath(fakeHeading(step))).toEqual([
      '3. Лечение',
      '3.1 Купирующая терапия',
      '3.1.4 Тяжёлая степень',
    ]);
    expect(sectionTitlePath(fakeHeading(treatment))).toEqual(['3. Лечение']);
  });
});

describe('sameTitlePath', () => {
  it('compares titles in order', () => {
    expect(sameTitlePath(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameTitlePath(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameTitlePath(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('sectionPathLabel', () => {
  it('shortens numbered titles to their number and keeps the others whole', () => {
    expect(sectionPathLabel('3. Лечение')).toBe('3.');
    expect(sectionPathLabel('3.1 Купирующая терапия')).toBe('3.1');
    expect(sectionPathLabel('Приложение Г1. Шкала Гамильтона')).toBe('Приложение Г1.');
    expect(sectionPathLabel('Приложение Б. Алгоритмы действий врача')).toBe('Приложение Б.');
    expect(sectionPathLabel('Критерии оценки качества')).toBe('Критерии оценки качества');
    expect(sectionPathLabel('2019 год')).toBe('2019');
  });
});
