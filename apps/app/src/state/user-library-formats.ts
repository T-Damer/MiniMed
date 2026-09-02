import {
  USER_LIBRARY_FILE_CAPABILITIES,
  userLibraryFileCapability,
  userLibraryFileExtension,
} from '@/state/user-library-capabilities';
import {
  normalizeUserLibraryTextPages,
  splitUserLibraryTextPages,
  USER_LIBRARY_TEXT_PAGE_BREAK,
} from '@/state/user-library-text-pages';
import { listZipEntries, readZipEntry } from '@/state/user-library-zip';

function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

function decodeXmlBytes(bytes: Uint8Array, fallbackEncoding = 'utf-8'): string {
  const header = new TextDecoder('ascii').decode(bytes.slice(0, 1024));
  const declared = /encoding\s*=\s*["']([^"']+)["']/iu.exec(header)?.[1]?.toLowerCase();
  const encoding = declared === 'cp1251' ? 'windows-1251' : declared;
  for (const candidate of [encoding, 'utf-8', fallbackEncoding]) {
    if (!candidate) continue;
    try {
      return new TextDecoder(candidate, { fatal: true }).decode(bytes);
    } catch {
      // Try the next encoding when a book's declaration or bytes are invalid.
    }
  }
  return decodeBytes(bytes);
}

function decodeRtfBytes(bytes: Uint8Array): string {
  let utf8: string | undefined;
  try {
    utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // RTF files from Windows often contain raw bytes from their declared codepage.
  }
  if (utf8 && [...utf8].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) {
    return utf8;
  }

  const header = new TextDecoder('ascii').decode(bytes.slice(0, 4096));
  const codepage = /\\ansicpg(\d+)/u.exec(header)?.[1] ?? '1252';
  try {
    return new TextDecoder(`windows-${codepage}`).decode(bytes);
  } catch {
    return decodeBytes(bytes);
  }
}

function extractPlainText(bytes: Uint8Array): string {
  return decodeBytes(bytes);
}

function extractHtmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
}

function decodeRtfUnicode(value: string): string {
  const signed = Number.parseInt(value, 10);
  if (Number.isNaN(signed)) return '';
  const code = signed < 0 ? signed + 65536 : signed;
  return String.fromCodePoint(code);
}

function extractRtfText(rtf: string): string {
  const codepage = /\\ansicpg(\d+)/u.exec(rtf)?.[1] ?? '1252';
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(`windows-${codepage}`);
  } catch {
    decoder = new TextDecoder('latin1');
  }

  interface RtfFrame {
    skip: boolean;
    hex: number[];
  }
  const stack: RtfFrame[] = [{ skip: false, hex: [] }];
  let text = '';
  let unicodeFallbacks = 0;

  const flushHex = (frame: RtfFrame): void => {
    if (frame.hex.length === 0) return;
    if (!frame.skip) {
      const bytes = new Uint8Array(frame.hex);
      // Some generators write UTF-8 bytes without declaring it. Valid multibyte
      // UTF-8 wins over the declared codepage; pure ASCII decodes identically.
      try {
        const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if ([...utf8].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) {
          text += utf8;
          frame.hex = [];
          return;
        }
      } catch {
        // not valid UTF-8 — use the declared codepage
      }
      text += decoder.decode(bytes);
    }
    frame.hex = [];
  };

  const DESTINATIONS =
    /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|footnote|themedata|datastore|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|pgptbl|wgrffmtfilter)$/iu;

  let index = 0;
  while (index < rtf.length) {
    const char = rtf[index];
    if (char === '{') {
      const top = stack.at(-1);
      if (top) flushHex(top);
      stack.push({ skip: stack.at(-1)?.skip ?? false, hex: [] });
      index += 1;
      continue;
    }
    if (char === '}') {
      const frame = stack.pop();
      if (frame) flushHex(frame);
      index += 1;
      continue;
    }
    if (char === '\\') {
      index += 1;
      const next = rtf[index];
      if (next === undefined) break;
      const top = stack.at(-1);
      if (!top) break;
      if (next === '\\' || next === '{' || next === '}') {
        flushHex(top);
        if (!top.skip) text += next;
        index += 1;
        continue;
      }
      if (next === "'") {
        const code = Number.parseInt(rtf.slice(index + 1, index + 3), 16);
        if (!Number.isNaN(code)) top.hex.push(code);
        index += 3;
        continue;
      }
      const unicode = /^u(-?\d+)\s?/u.exec(rtf.slice(index));
      if (unicode) {
        flushHex(top);
        if (!top.skip) text += decodeRtfUnicode(unicode[1] ?? '');
        index += unicode[0].length;
        unicodeFallbacks = 1;
        continue;
      }
      const word = /^([a-z]+)(-?\d+)? ?/iu.exec(rtf.slice(index));
      if (word) {
        index += word[0].length;
        if (unicodeFallbacks > 0) {
          unicodeFallbacks = 0;
          continue;
        }
        const name = word[1] ?? '';
        if (name === 'par' || name === 'line') {
          flushHex(top);
          if (!top.skip) text += '\n';
        }
        if (DESTINATIONS.test(name)) {
          flushHex(top);
          top.skip = true;
        }
        continue;
      }
      index += 1;
      continue;
    }
    const top = stack.at(-1);
    if (!top) break;
    if (unicodeFallbacks > 0) {
      unicodeFallbacks -= 1;
      index += 1;
      continue;
    }
    if (top.hex.length > 0) flushHex(top);
    if (!top.skip) text += char;
    index += 1;
  }
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame) flushHex(frame);
  }

  return text
    .replace(/[\t]+/gu, ' ')
    .replace(/\\n\s*/gu, '\n')
    .trim();
}
function extractFb2Text(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parts: string[] = [];
  for (const title of Array.from(doc.getElementsByTagName('title'))) {
    const content = title.textContent?.trim();
    if (content) parts.push(content);
  }
  for (const paragraph of Array.from(doc.getElementsByTagName('p'))) {
    const content = paragraph.textContent?.trim();
    if (content) parts.push(content);
  }
  return parts
    .join('\n')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function appendDocxPageBreak(output: string[]): void {
  while (output.at(-1) === '\n') output.pop();
  if (output.at(-1) !== USER_LIBRARY_TEXT_PAGE_BREAK) {
    output.push(USER_LIBRARY_TEXT_PAGE_BREAK);
  }
}

function appendDocxParagraphBreak(output: string[]): void {
  const previous = output.at(-1);
  if (previous !== undefined && previous !== '\n' && previous !== USER_LIBRARY_TEXT_PAGE_BREAK) {
    output.push('\n');
  }
}

function appendDocxNodeText(node: Node, output: string[]): void {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  if (element.namespaceURI === WORD_NS && element.localName === 't') {
    output.push(element.textContent ?? '');
    return;
  }
  if (element.namespaceURI === WORD_NS && element.localName === 'tab') {
    output.push('\t');
    return;
  }
  if (element.namespaceURI === WORD_NS && element.localName === 'lastRenderedPageBreak') {
    appendDocxPageBreak(output);
    return;
  }
  if (element.namespaceURI === WORD_NS && element.localName === 'br') {
    const type = element.getAttributeNS(WORD_NS, 'type') ?? element.getAttribute('w:type');
    if (type === 'page') appendDocxPageBreak(output);
    else output.push('\n');
    return;
  }
  for (const child of Array.from(element.childNodes)) appendDocxNodeText(child, output);
}

function appendDocxContainer(container: Element, output: string[]): void {
  for (const child of Array.from(container.children)) {
    if (child.namespaceURI !== WORD_NS) continue;
    if (child.localName === 'p') {
      for (const node of Array.from(child.childNodes)) appendDocxNodeText(node, output);
      if (child.getElementsByTagNameNS(WORD_NS, 'sectPr').length > 0) {
        appendDocxPageBreak(output);
      } else {
        appendDocxParagraphBreak(output);
      }
      continue;
    }
    if (child.localName !== 'tbl') continue;
    const rows = Array.from(child.children).filter(
      (row) => row.namespaceURI === WORD_NS && row.localName === 'tr',
    );
    for (const row of rows) {
      const cells = Array.from(row.children).filter(
        (cell) => cell.namespaceURI === WORD_NS && cell.localName === 'tc',
      );
      cells.forEach((cell, index) => {
        appendDocxContainer(cell, output);
        if (index < cells.length - 1) output.push('\t');
      });
      appendDocxParagraphBreak(output);
    }
  }
}

function normalizeDocxExtractedText(value: string): string {
  return value
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\n*\f\n*/gu, USER_LIBRARY_TEXT_PAGE_BREAK)
    .replace(/^[ \t\n]+|[ \t\n]+$/gu, '');
}

function decodeDocxXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function extractDocxTextFallback(xml: string): string {
  const withStructure = xml
    .replace(
      /<w:br\b(?=[^>]*\bw:type\s*=\s*["']page["'])[^>]*\/?\s*>/giu,
      USER_LIBRARY_TEXT_PAGE_BREAK,
    )
    .replace(/<w:lastRenderedPageBreak\b[^>]*\/?\s*>/giu, USER_LIBRARY_TEXT_PAGE_BREAK)
    .replace(/<w:tab\b[^>]*\/?\s*>/giu, '\t')
    .replace(/<w:br\b[^>]*\/?\s*>/giu, '\n')
    .replace(/<\/w:tc>/giu, '\t')
    .replace(/<\/w:tr>/giu, '\n')
    .replace(/<\/w:p>/giu, '\n')
    .replace(/<[^>]+>/gu, '');
  return normalizeDocxExtractedText(decodeDocxXmlEntities(withStructure));
}

function extractDocxText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if (!body) return extractDocxTextFallback(xml);

  const parts: string[] = [];
  appendDocxContainer(body, parts);
  return normalizeDocxExtractedText(parts.join(''));
}

function resolveOpfPath(containerXml: string): string | null {
  const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const rootfile = doc.querySelector('rootfile[media-type="application/oebps-package+xml"]');
  return rootfile?.getAttribute('full-path') ?? rootfile?.getAttribute('fullPath') ?? null;
}

function resolveSpineHrefs(opfXml: string): readonly string[] {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml');
  const manifest = new Map<string, string>();
  for (const item of Array.from(doc.getElementsByTagName('item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  }
  const hrefs: string[] = [];
  for (const itemref of Array.from(doc.getElementsByTagName('itemref'))) {
    const idref = itemref.getAttribute('idref');
    if (!idref) continue;
    const href = manifest.get(idref);
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function joinZipPath(base: string, relative: string): string {
  if (relative.startsWith('/')) return relative.slice(1);
  const baseParts = base.includes('/') ? base.split('/').slice(0, -1) : [];
  const relativeParts = relative.split('/');
  const parts = [...baseParts];
  for (const segment of relativeParts) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

async function extractEpubText(data: ArrayBuffer): Promise<string> {
  const containerBytes = await readZipEntry(data, 'META-INF/container.xml');
  if (!containerBytes) return '';
  const containerXml = decodeXmlBytes(containerBytes);
  const opfPath = resolveOpfPath(containerXml);
  if (!opfPath) return '';
  const opfBytes = await readZipEntry(data, opfPath);
  if (!opfBytes) return '';
  const opfXml = decodeXmlBytes(opfBytes);
  const hrefs = resolveSpineHrefs(opfXml);
  const parts: string[] = [];
  for (const href of hrefs) {
    const contentPath = joinZipPath(opfPath, href);
    const contentBytes = await readZipEntry(data, contentPath);
    if (!contentBytes) continue;
    const content = decodeXmlBytes(contentBytes);
    parts.push(extractHtmlText(content));
  }
  return parts
    .join('\n')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

async function extractSpreadsheetText(data: ArrayBuffer): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, { type: 'array', codepage: 65001 });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = sheet ? XLSX.utils.sheet_to_csv(sheet, { blankrows: false }) : '';
    return [sheetName, rows.trim()].filter(Boolean).join('\n');
  })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function slideNumber(path: string): number {
  const match = /slide(\d+)\.xml$/u.exec(path);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function extractPptxText(data: ArrayBuffer): Promise<string> {
  const entries = (await listZipEntries(data))
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/u.test(path))
    .toSorted((left, right) => slideNumber(left) - slideNumber(right));
  const slides: string[] = [];
  for (const path of entries) {
    const bytes = await readZipEntry(data, path);
    if (!bytes) continue;
    const doc = new DOMParser().parseFromString(decodeBytes(bytes), 'application/xml');
    const text = Array.from(doc.getElementsByTagNameNS(DRAWING_NS, 't'))
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean)
      .join('\n');
    if (text) slides.push(text);
  }
  return slides.join('\n\n').trim();
}

function extensionOf(fileName: string): string {
  return userLibraryFileExtension(fileName);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function isEditableUserLibraryFile(fileName: string, mimeType: string): boolean {
  const extension = extensionOf(fileName);
  return (
    (extension === 'txt' && mimeType === 'text/plain') ||
    ((extension === 'md' || extension === 'markdown') && mimeType === 'text/markdown') ||
    (extension === 'rtf' && (mimeType === 'text/rtf' || mimeType === 'application/rtf')) ||
    (extension === 'docx' && mimeType === DOCX_MIME)
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function escapeRtf(value: string): string {
  return value.replace(/[\\{}]/gu, (character) => `\\${character}`);
}

function createRtfText(text: string): string {
  const output = ['{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\viewkind4\\uc1\\f0\\fs22 '];
  const normalized = text.replace(/\r\n?/gu, '\n');
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const character = normalized[index] ?? '';
    if (character === '\n') {
      output.push('\\par\n');
    } else if (character === '\t') {
      output.push('\\tab ');
    } else if (code >= 0x20 && code <= 0x7e) {
      output.push(escapeRtf(character));
    } else {
      const signed = code > 0x7fff ? code - 0x10000 : code;
      output.push(`\\u${String(signed)}?`);
    }
  }
  output.push('}');
  return output.join('');
}

function createDocxDocumentXml(text: string): string {
  const paragraphs = splitUserLibraryTextPages(text).flatMap((page, pageIndex, pages) => {
    const content = page.split('\n').map((line) => {
      const escaped = escapeXml(line);
      return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
    });
    if (pageIndex < pages.length - 1) {
      content.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
    return content;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
}

function writeLittleUint16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
}

function writeLittleUint32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
  buffer[offset + 3] = (value >>> 24) & 0xff;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function createStoredZip(
  entries: readonly { readonly path: string; readonly text: string }[],
): ArrayBuffer {
  const encoder = new TextEncoder();
  const encoded = entries.map((entry) => ({
    path: encoder.encode(entry.path),
    bytes: encoder.encode(entry.text),
  }));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of encoded) {
    const checksum = crc32(entry.bytes);
    const local = new Uint8Array(30 + entry.path.length);
    writeLittleUint32(local, 0, 0x04034b50);
    writeLittleUint16(local, 4, 20);
    writeLittleUint16(local, 6, 0x800);
    writeLittleUint32(local, 14, checksum);
    writeLittleUint32(local, 18, entry.bytes.length);
    writeLittleUint32(local, 22, entry.bytes.length);
    writeLittleUint16(local, 26, entry.path.length);
    local.set(entry.path, 30);
    localParts.push(local, entry.bytes);

    const central = new Uint8Array(46 + entry.path.length);
    writeLittleUint32(central, 0, 0x02014b50);
    writeLittleUint16(central, 4, 20);
    writeLittleUint16(central, 6, 20);
    writeLittleUint16(central, 8, 0x800);
    writeLittleUint32(central, 16, checksum);
    writeLittleUint32(central, 20, entry.bytes.length);
    writeLittleUint32(central, 24, entry.bytes.length);
    writeLittleUint16(central, 28, entry.path.length);
    writeLittleUint32(central, 42, localOffset);
    central.set(entry.path, 46);
    centralParts.push(central);
    localOffset += local.length + entry.bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  writeLittleUint32(end, 0, 0x06054b50);
  writeLittleUint16(end, 8, encoded.length);
  writeLittleUint16(end, 10, encoded.length);
  writeLittleUint32(end, 12, centralSize);
  writeLittleUint32(end, 16, localOffset);
  const output = new Uint8Array(localOffset + centralSize + end.length);
  let offset = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    output.set(part, offset);
    offset += part.length;
  }
  return output.buffer;
}

export function createEditableUserLibraryFile(
  fileName: string,
  mimeType: string,
  text: string,
): File {
  if (!isEditableUserLibraryFile(fileName, mimeType)) {
    throw new Error('Этот тип файла нельзя редактировать во встроенном редакторе.');
  }
  const extension = extensionOf(fileName);
  const normalized = normalizeUserLibraryTextPages(text);
  if (extension === 'rtf') {
    return new File([createRtfText(normalized)], fileName, { type: mimeType });
  }
  if (extension === 'docx') {
    const zip = createStoredZip([
      {
        path: '[Content_Types].xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/></Types>`,
      },
      {
        path: '_rels/.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      },
      { path: 'word/document.xml', text: createDocxDocumentXml(normalized) },
    ]);
    return new File([zip], fileName, { type: mimeType });
  }
  return new File([normalized], fileName, { type: mimeType });
}

function isZipOfficeFormat(fileName: string, mimeType: string): boolean {
  const capability = userLibraryFileCapability(mimeType, fileName);
  return (
    capability === USER_LIBRARY_FILE_CAPABILITIES.docx ||
    capability === USER_LIBRARY_FILE_CAPABILITIES.pptx ||
    capability === USER_LIBRARY_FILE_CAPABILITIES.epub ||
    capability === USER_LIBRARY_FILE_CAPABILITIES.xlsx
  );
}

export async function validateUserLibraryFile(
  fileName: string,
  mimeType: string,
  data: ArrayBuffer,
): Promise<void> {
  const extension = extensionOf(fileName);
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) throw new Error('Файл пустой.');

  if (extension === 'pdf') {
    const header = decodeBytes(bytes.slice(0, 5));
    if (header !== '%PDF-') throw new Error('Файл PDF имеет некорректный заголовок.');
  }

  if (extension === 'dcm' || extension === 'dicom' || mimeType === 'application/dicom') {
    const prefix = decodeBytes(bytes.slice(128, 132));
    if (bytes.byteLength < 132 || prefix !== 'DICM') {
      throw new Error('Файл DICOM не содержит заголовок Part 10.');
    }
  }

  if (isZipOfficeFormat(fileName, mimeType)) {
    let entries: readonly string[];
    try {
      entries = await listZipEntries(data);
    } catch {
      throw new Error('Не удалось проверить структуру ZIP-документа.');
    }
    const extraction = userLibraryFileCapability(mimeType, fileName).textExtraction;
    const requiredEntry =
      extraction === 'docx'
        ? 'word/document.xml'
        : extraction === 'pptx'
          ? 'ppt/presentation.xml'
          : extraction === 'spreadsheet'
            ? 'xl/workbook.xml'
            : extraction === 'epub'
              ? 'META-INF/container.xml'
              : null;
    if (requiredEntry && !entries.includes(requiredEntry)) {
      throw new Error(`Файл ${extension.toUpperCase()} не содержит обязательную структуру.`);
    }
    return;
  }

  if (extension === 'rtf' && !decodeBytes(bytes.slice(0, 32)).trimStart().startsWith('{\\rtf')) {
    throw new Error('Файл RTF имеет некорректный заголовок.');
  }
  if (
    extension === 'fb2' &&
    !/<FictionBook(?:\s|>)/iu.test(decodeXmlBytes(bytes.slice(0, 4096), 'windows-1251'))
  ) {
    throw new Error('Файл FB2 имеет некорректную структуру.');
  }
}

export async function userLibraryArchiveHasImages(
  fileName: string,
  mimeType: string,
  data: ArrayBuffer,
): Promise<boolean> {
  if (!isZipOfficeFormat(fileName, mimeType)) return false;
  try {
    const entries = await listZipEntries(data);
    return entries.some((path) =>
      /(?:^|\/)(?:media|images?|quicklook)\/.*\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg|emf|wmf)$/iu.test(
        path,
      ),
    );
  } catch {
    return false;
  }
}

export async function extractUserLibraryText(
  fileName: string,
  mimeType: string,
  data: ArrayBuffer,
): Promise<string> {
  const bytes = new Uint8Array(data);
  switch (userLibraryFileCapability(mimeType, fileName).textExtraction) {
    case 'html':
      return extractHtmlText(decodeBytes(bytes));
    case 'rtf':
      return extractRtfText(decodeRtfBytes(bytes));
    case 'fb2':
      return extractFb2Text(decodeXmlBytes(bytes, 'windows-1251'));
    case 'docx': {
      const documentXml = await readZipEntry(data, 'word/document.xml');
      return documentXml ? extractDocxText(decodeBytes(documentXml)) : '';
    }
    case 'pptx':
      return extractPptxText(data);
    case 'epub':
      return extractEpubText(data);
    case 'spreadsheet':
      return extractSpreadsheetText(data);
    case 'plain':
      return extractPlainText(bytes);
    case 'none':
      return '';
  }
}
