import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractUserLibraryText, validateUserLibraryFile } from '@/state/user-library-formats';
import { readZipEntry } from '@/state/user-library-zip';

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE = 0x06054b50;

function writeUint16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

function writeUint32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
  buffer[offset + 3] = (value >> 24) & 0xff;
}

function buildStoredZip(entries: Readonly<Record<string, string>>): ArrayBuffer {
  const encodedEntries = Object.entries(entries).map(([path, content]) => ({
    path,
    bytes: new TextEncoder().encode(content),
  }));

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of encodedEntries) {
    const pathBytes = new TextEncoder().encode(entry.path);
    const localHeader = new Uint8Array(30 + pathBytes.length);
    writeUint32(localHeader, 0, LOCAL_FILE_SIGNATURE);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 26, pathBytes.length);
    localHeader.set(pathBytes, 30);
    localParts.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + pathBytes.length);
    writeUint32(centralHeader, 0, CENTRAL_DIR_SIGNATURE);
    writeUint16(centralHeader, 10, 0);
    writeUint32(centralHeader, 20, entry.bytes.length);
    writeUint32(centralHeader, 24, entry.bytes.length);
    writeUint16(centralHeader, 28, pathBytes.length);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(pathBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + entry.bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  writeUint32(eocd, 0, END_OF_CENTRAL_DIR_SIGNATURE);
  writeUint16(eocd, 8, encodedEntries.length);
  writeUint16(eocd, 10, encodedEntries.length);
  writeUint32(eocd, 12, centralSize);
  writeUint32(eocd, 16, offset);

  const totalLength =
    localParts.reduce((sum, part) => sum + part.length, 0) + centralSize + eocd.length;
  const output = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const part of localParts) {
    output.set(part, writeOffset);
    writeOffset += part.length;
  }
  for (const part of centralParts) {
    output.set(part, writeOffset);
    writeOffset += part.length;
  }
  output.set(eocd, writeOffset);
  return output.buffer;
}

function installDomParser(): void {
  class StubElement {
    readonly textContent: string;
    constructor(text: string) {
      this.textContent = text;
    }
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }
    private readonly attributes = new Map<string, string>();
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }
  }

  class StubDocument {
    readonly body: { textContent: string };
    private readonly source: string;

    constructor(source: string, mime: string) {
      this.source = source;
      if (mime === 'text/html') {
        const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/iu.exec(source);
        const content = bodyMatch ? bodyMatch[1] : source;
        this.body = {
          textContent:
            content
              ?.replace(/<[^>]+>/gu, ' ')
              .replace(/\s+/gu, ' ')
              .trim() ?? '',
        };
      } else {
        this.body = { textContent: '' };
      }
    }

    getElementsByTagName(tag: string): StubElement[] {
      const results: StubElement[] = [];
      const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'giu');
      let match = pattern.exec(this.source);
      while (match) {
        const inner = match[1]?.replace(/<[^>]+>/gu, '').trim() ?? '';
        if (inner) results.push(new StubElement(inner));
        match = pattern.exec(this.source);
      }
      return results;
    }

    getElementsByTagNameNS(_namespace: string, localName: string): StubElement[] {
      if (localName === 't') {
        const results: StubElement[] = [];
        const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/giu;
        let match = pattern.exec(this.source);
        while (match) {
          results.push(new StubElement(match[1] ?? ''));
          match = pattern.exec(this.source);
        }
        return results;
      }
      return this.getElementsByTagName(localName);
    }

    querySelector(selector: string): StubElement | null {
      if (selector.includes('rootfile')) {
        const match = /<rootfile[^>]*full-path="([^"]+)"/iu.exec(this.source);
        if (!match) return null;
        const element = new StubElement('');
        element.setAttribute('full-path', match[1] ?? '');
        return element;
      }
      return null;
    }
  }

  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString(source: string, mime: string): StubDocument {
        return new StubDocument(source, mime);
      }
    },
  );
}

describe('user-library formats', () => {
  beforeEach(() => {
    installDomParser();
  });
  it('extracts plain RTF text with hex and unicode escapes', async () => {
    const rtf = '{\\rtf1\\ansi\\ab тест}';
    const text = await extractUserLibraryText(
      'note.rtf',
      'text/rtf',
      new TextEncoder().encode(rtf).buffer,
    );
    expect(text).toContain('тест');
  });

  it('extracts HTML body text', async () => {
    const html = '<html><head><title>Title</title></head><body><p>Пневмония</p></body></html>';
    const text = await extractUserLibraryText(
      'page.html',
      'text/html',
      new TextEncoder().encode(html).buffer,
    );
    expect(text).toContain('Пневмония');
    expect(text).not.toContain('<p>');
  });

  it('extracts FB2 section titles and paragraphs', async () => {
    const fb2 =
      '<?xml version="1.0"?><FictionBook><body><title><p>Заголовок</p></title><section><p>Основной текст</p></section></body></FictionBook>';
    const text = await extractUserLibraryText(
      'book.fb2',
      'application/x-fictionbook+xml',
      new TextEncoder().encode(fb2).buffer,
    );
    expect(text).toContain('Заголовок');
    expect(text).toContain('Основной текст');
  });

  it('extracts text from a stored DOCX zip', async () => {
    const documentXml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Клинический случай</w:t></w:r></w:p></w:body></w:document>';
    const zip = buildStoredZip({ 'word/document.xml': documentXml });
    const entry = await readZipEntry(zip, 'word/document.xml');
    expect(entry).toBeTruthy();
    const text = await extractUserLibraryText(
      'case.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      zip,
    );
    expect(text).toContain('Клинический случай');
  });

  it('rejects a ZIP file that is not a valid DOCX', async () => {
    const zip = buildStoredZip({ 'word/styles.xml': '<w:styles />' });
    await expect(
      validateUserLibraryFile(
        'case.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        zip,
      ),
    ).rejects.toThrow('обязательную структуру');
  });

  it('rejects a PDF extension with a non-PDF payload', async () => {
    await expect(
      validateUserLibraryFile(
        'case.pdf',
        'text/plain',
        new TextEncoder().encode('not a pdf').buffer,
      ),
    ).rejects.toThrow('некорректный заголовок');
  });
});

describe('rtf extraction (cyrillic + destinations)', () => {
  it('decodes raw Windows-1251 RTF text', async () => {
    const prefix = new TextEncoder().encode('{\\rtf1\\ansi\\ansicpg1251 ');
    const cyrillic = Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    const suffix = new TextEncoder().encode('}');
    const bytes = new Uint8Array(prefix.length + cyrillic.length + suffix.length);
    bytes.set(prefix);
    bytes.set(cyrillic, prefix.length);
    bytes.set(suffix, prefix.length + cyrillic.length);
    const text = await extractUserLibraryText('raw.rtf', 'text/rtf', bytes.buffer);
    expect(text).toContain('Привет');
  });

  it('decodes cp1251 hex runs and survives fonttbl groups', async () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1251{\\fonttbl{\\f0 Times;}}\\f0 \\'cf\\'f0\\'e8\\'e2\\'e5\\'f2, \\'ec\\'e8\\'f0!\\par}";
    const bytes = new TextEncoder().encode(rtf);
    const text = await extractUserLibraryText(
      'z.rtf',
      'application/rtf',
      bytes.buffer as ArrayBuffer,
    );
    expect(text).toContain('Привет, мир!');
    expect(text).not.toContain('Times');
  });

  it('decodes unicode escapes', async () => {
    const rtf = '{\\rtf1\\u1055?\\u1088?\\u1080?}';
    const bytes = new TextEncoder().encode(rtf);
    const text = await extractUserLibraryText('u.rtf', 'text/rtf', bytes.buffer as ArrayBuffer);
    expect(text).toContain('При');
  });
});

describe('rtf utf-8 and pages', () => {
  it('decodes utf-8 hex runs without ansicpg', async () => {
    // «Привет» in utf-8 bytes, no \ansicpg declaration
    const rtf =
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 \\'d0\\'9f\\'d1\\'80\\'d0\\'b8\\'d0\\'b2\\'d0\\'b5\\'d1\\'82!}";
    const text = await extractUserLibraryText(
      'u8.rtf',
      'application/rtf',
      new TextEncoder().encode(rtf).buffer as ArrayBuffer,
    );
    expect(text).toContain('Привет!');
  });

  it('extracts text from iWork-08 style Pages packages', async () => {
    const indexXml =
      '<?xml version="1.0"?><sl:document xmlns:sl="x"><sl:text-body>Согласие на обработку персональных данных</sl:text-body></sl:document>';
    const zip = buildStoredZip({ 'index.xml': indexXml });
    const text = await extractUserLibraryText('consent.pages', 'application/vnd.apple.pages', zip);
    expect(text).toContain('Согласие на обработку персональных данных');
  });
});
