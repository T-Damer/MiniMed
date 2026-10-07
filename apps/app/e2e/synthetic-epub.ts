import JSZip from 'jszip';

export interface SyntheticEpubOptions {
  /**
   * The book's own `dc:title`. Left out by default: the library names a book by its `dc:title` once
   * it has been read, and most specs find their card by the file name.
   */
  readonly title?: string;
  /** `dc:creator`. */
  readonly author?: string;
  /** CSS of the chapters, to prove the reader overrides a book's own white page. */
  readonly css?: string;
}

/**
 * A small generated EPUB 3 book for reader tests: ten chapters of neutral text, each a
 * `.chapter` block whose heading has the id `chapNN`. No third-party book is shipped for tests.
 */
export async function syntheticEpub(options: SyntheticEpubOptions = {}): Promise<Buffer> {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const chapters = roman.map((numeral, index) => {
    const number = String(index + 1).padStart(2, '0');
    const title = `Глава ${numeral}. Проверочный раздел ${index + 1}`;
    const paragraphs = Array.from(
      { length: 40 },
      (_, paragraph) =>
        `<p>Раздел ${index + 1}, абзац ${paragraph + 1}. Этот текст нужен только для проверки ` +
        'прокрутки, оглавления и выделений в читалке; он не описывает ничего реального.</p>',
    ).join('\n');
    return {
      id: `chap${number}`,
      file: `chap${number}.xhtml`,
      title,
      body: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru" lang="ru">
<head><title>${title}</title>${options.css ? `<style>${options.css}</style>` : ''}</head>
<body><div class="chapter"><h2 id="chap${number}">${title}</h2>
${paragraphs}
</div></body></html>`,
    };
  });
  const zip = new JSZip();
  // The mimetype entry must come first and stay uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="ru">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:minimed:synthetic-book</dc:identifier>
    ${options.title ? `<dc:title>${options.title}</dc:title>` : ''}
    ${options.author ? `<dc:creator>${options.author}</dc:creator>` : ''}
    <dc:language>ru</dc:language>
    <meta property="dcterms:modified">2026-09-27T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${chapters.map((chapter) => `<item id="${chapter.id}" href="${chapter.file}" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join('\n    ')}
  </spine>
</package>`,
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru" lang="ru">
<head><title>Оглавление</title></head>
<body><nav epub:type="toc" id="toc"><ol>
${chapters.map((chapter) => `<li><a href="${chapter.file}#${chapter.id}">${chapter.title}</a></li>`).join('\n')}
</ol></nav></body></html>`,
  );
  for (const chapter of chapters) zip.file(`OEBPS/${chapter.file}`, chapter.body);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}
