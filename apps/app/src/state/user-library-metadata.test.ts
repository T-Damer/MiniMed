import { describe, expect, it } from 'vitest';

import {
  defaultUserLibraryTitle,
  parseEpubPackageMetadata,
  parseFb2Metadata,
  titleFromEmbeddedMetadata,
} from '@/state/user-library-metadata';

describe('parseEpubPackageMetadata', () => {
  it('reads dc:title and every dc:creator', () => {
    const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="id">urn:x</dc:identifier>
        <dc:title id="t1">Артериальная   гипертензия &amp; её&#160;лечение</dc:title>
        <dc:title id="t2">Второе название</dc:title>
        <dc:creator opf:role="aut">И. И. Иванов</dc:creator>
        <dc:creator>П. П. Петров</dc:creator>
        <dc:creator>И. И. Иванов</dc:creator>
      </metadata></package>`;
    expect(parseEpubPackageMetadata(opf)).toEqual({
      title: 'Артериальная гипертензия & её лечение',
      author: 'И. И. Иванов, П. П. Петров',
    });
  });

  it('accepts another namespace prefix, CDATA and an EPUB 2 package', () => {
    const opf = `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:metadata>
      <dc:title><![CDATA[Кардиология: <краткий> курс]]></dc:title></opf:metadata></opf:package>`;
    expect(parseEpubPackageMetadata(opf)).toEqual({ title: 'Кардиология: <краткий> курс' });
  });

  it('ignores titles outside the metadata block and empty ones', () => {
    expect(
      parseEpubPackageMetadata(
        '<package><metadata><dc:title>  </dc:title></metadata><guide><title>Обложка</title></guide></package>',
      ),
    ).toEqual({});
  });

  it('caps a very long title', () => {
    const opf = `<package><metadata><dc:title>${'я'.repeat(400)}</dc:title></metadata></package>`;
    const title = parseEpubPackageMetadata(opf).title ?? '';
    expect([...title]).toHaveLength(256);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('parseFb2Metadata', () => {
  it('reads book-title and author names from title-info', () => {
    const xml = `<FictionBook><description><title-info>
      <author><first-name>Анна</first-name><last-name>Орлова</last-name></author>
      <book-title>Заметки терапевта</book-title></title-info>
      <document-info><author><nickname>scan</nickname></author></document-info></description></FictionBook>`;
    expect(parseFb2Metadata(xml)).toEqual({ title: 'Заметки терапевта', author: 'Анна Орлова' });
  });

  it('returns nothing without title-info', () => {
    expect(parseFb2Metadata('<FictionBook><body/></FictionBook>')).toEqual({});
  });
});

describe('titleFromEmbeddedMetadata', () => {
  const book = { title: 'big-book', fileName: 'big-book.epub' };

  it('replaces the file-name title of a file nobody renamed', () => {
    expect(titleFromEmbeddedMetadata(book, { title: 'Проверочная книга' })).toBe(
      'Проверочная книга',
    );
  });

  it('keeps a title the user typed', () => {
    expect(
      titleFromEmbeddedMetadata({ ...book, title: 'Моя книга' }, { title: 'Проверочная книга' }),
    ).toBeUndefined();
  });

  it('does nothing without an embedded title or when it already matches', () => {
    expect(titleFromEmbeddedMetadata(book, {})).toBeUndefined();
    expect(titleFromEmbeddedMetadata(book, { title: 'big-book' })).toBeUndefined();
  });
});

describe('defaultUserLibraryTitle', () => {
  it('drops the extension, but keeps a name that is only an extension', () => {
    expect(defaultUserLibraryTitle('big-book.epub')).toBe('big-book');
    expect(defaultUserLibraryTitle('a.b.pdf')).toBe('a.b');
    expect(defaultUserLibraryTitle('.pdf')).toBe('.pdf');
  });
});
