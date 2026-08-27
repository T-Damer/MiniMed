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
function extractXmlText(xml: string, tagNames: readonly string[]): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parts: string[] = [];
  for (const tagName of tagNames) {
    for (const element of Array.from(doc.getElementsByTagName(tagName))) {
      const content = element.textContent?.trim();
      if (content) parts.push(content);
    }
  }
  return parts
    .join('\n')
    .replace(/[ \t]+/gu, ' ')
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

function textFromNamespacedElement(element: Element, namespace: string, localName: string): string {
  return Array.from(element.getElementsByTagNameNS(namespace, localName))
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
}

function extractDocxText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if (!body) return extractXmlText(xml, ['w:t']);

  const parts: string[] = [];
  for (const child of Array.from(body.children)) {
    if (child.localName === 'p') {
      const paragraph = textFromNamespacedElement(child, WORD_NS, 't');
      if (paragraph) parts.push(paragraph);
      continue;
    }
    if (child.localName !== 'tbl') continue;
    for (const row of Array.from(child.getElementsByTagNameNS(WORD_NS, 'tr'))) {
      const cells = Array.from(row.getElementsByTagNameNS(WORD_NS, 'tc'))
        .map((cell) => textFromNamespacedElement(cell, WORD_NS, 't'))
        .filter(Boolean);
      if (cells.length > 0) parts.push(cells.join('\t'));
    }
  }
  return parts
    .join('\n')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
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

function isPrintableAscii(char: number): boolean {
  return char >= 32 && char <= 126;
}

function extractBinaryText(data: Uint8Array): string {
  const runs: string[] = [];
  let asciiRun = '';
  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index] ?? 0;
    if (isPrintableAscii(byte)) {
      asciiRun += String.fromCharCode(byte);
    } else if (asciiRun.length >= 8) {
      runs.push(asciiRun);
      asciiRun = '';
    } else {
      asciiRun = '';
    }
  }
  if (asciiRun.length >= 8) runs.push(asciiRun);

  let utf16Run = '';
  for (let index = 0; index < data.length - 1; index += 2) {
    const code = (data[index] ?? 0) | ((data[index + 1] ?? 0) << 8);
    if ((code >= 32 && code <= 126) || (code >= 0x0400 && code <= 0x04ff)) {
      utf16Run += String.fromCharCode(code);
    } else if (utf16Run.length >= 8) {
      runs.push(utf16Run);
      utf16Run = '';
    } else {
      utf16Run = '';
    }
  }
  if (utf16Run.length >= 8) runs.push(utf16Run);

  return [...new Set(runs.map((run) => run.replace(/\s+/gu, ' ').trim()).filter(Boolean))]
    .join('\n')
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

async function extractPagesText(data: ArrayBuffer): Promise<string> {
  const entries = await listZipEntries(data);
  const xmlCandidates = entries.filter((path) => /(^|\/)(index|document)\.xml$/iu.test(path));
  const parts: string[] = [];
  for (const path of xmlCandidates) {
    const bytes = await readZipEntry(data, path);
    if (!bytes) continue;
    const text = extractXmlText(decodeBytes(bytes), ['sf:p', 'sf:span', 'text']);
    if (text) parts.push(text);
  }
  if (parts.length > 0) return parts.join('\n').trim();

  // Modern .pages stores content in Protobuf/IWA streams. We do not attempt to interpret layout
  // here, but extracting sufficiently long UTF-8/UTF-16 runs still gives search a useful textual
  // fallback without executing embedded content.
  for (const path of entries.filter((entry) => entry.toLowerCase().endsWith('.iwa'))) {
    const bytes = await readZipEntry(data, path);
    if (!bytes) continue;
    const text = extractBinaryText(bytes);
    if (text) parts.push(text);
  }
  return [...new Set(parts)].join('\n').trim();
}

function extensionOf(fileName: string): string {
  const lower = fileName.toLocaleLowerCase('ru-RU');
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot + 1) : '';
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
  const paragraphs = text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => {
      const content = escapeXml(line);
      return `<w:p><w:r><w:t xml:space="preserve">${content}</w:t></w:r></w:p>`;
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
  const normalized = text.replace(/\r\n?/gu, '\n');
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

function isZipOfficeFormat(extension: string, mimeType: string): boolean {
  return (
    extension === 'docx' ||
    extension === 'pptx' ||
    extension === 'pages' ||
    extension === 'epub' ||
    mimeType.includes('openxmlformats') ||
    mimeType === 'application/vnd.apple.pages' ||
    mimeType === 'application/epub+zip'
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

  if (isZipOfficeFormat(extension, mimeType)) {
    let entries: readonly string[];
    try {
      entries = await listZipEntries(data);
    } catch {
      throw new Error('Не удалось проверить структуру ZIP-документа.');
    }
    const requiredEntry =
      extension === 'docx'
        ? 'word/document.xml'
        : extension === 'pptx'
          ? 'ppt/presentation.xml'
          : extension === 'epub'
            ? 'META-INF/container.xml'
            : null;
    if (requiredEntry && !entries.includes(requiredEntry)) {
      throw new Error(`Файл ${extension.toUpperCase()} не содержит обязательную структуру.`);
    }
    if (extension === 'pages' && !entries.some((entry) => entry.endsWith('.iwa'))) {
      throw new Error('Файл Pages не содержит читаемых данных.');
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
  const extension = extensionOf(fileName);
  if (!isZipOfficeFormat(extension, mimeType)) return false;
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
  const extension = extensionOf(fileName);

  if (mimeType === 'text/html' || extension === 'html' || extension === 'htm') {
    return extractHtmlText(decodeBytes(bytes));
  }

  if (mimeType === 'text/rtf' || mimeType === 'application/rtf' || extension === 'rtf') {
    return extractRtfText(decodeRtfBytes(bytes));
  }

  if (mimeType === 'application/vnd.apple.pages' || extension === 'pages') {
    // iWork '08-style packages keep plain index.xml; newer ones use Snappy
    // streams and fall through to the generic-file panel.
    const indexBytes = await readZipEntry(data, 'index.xml');
    if (indexBytes) return extractHtmlText(decodeBytes(indexBytes));
    return '';
  }

  if (
    mimeType === 'application/x-fictionbook+xml' ||
    extension === 'fb2' ||
    (extension === 'xml' &&
      bytes.length > 4 &&
      /<FictionBook(?:\s|>)/iu.test(decodeXmlBytes(bytes.slice(0, 100), 'windows-1251')))
  ) {
    return extractFb2Text(decodeXmlBytes(bytes, 'windows-1251'));
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === 'docx'
  ) {
    const documentXml = await readZipEntry(data, 'word/document.xml');
    if (!documentXml) return '';
    return extractDocxText(decodeBytes(documentXml));
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    extension === 'pptx'
  ) {
    return await extractPptxText(data);
  }

  if (mimeType === 'application/epub+zip' || extension === 'epub') {
    return await extractEpubText(data);
  }

  if (mimeType === 'application/vnd.apple.pages' || extension === 'pages') {
    return await extractPagesText(data);
  }

  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    extension === 'doc' ||
    extension === 'ppt'
  ) {
    return extractBinaryText(bytes);
  }

  return extractPlainText(bytes);
}
