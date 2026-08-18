import { readZipEntry } from '@/state/user-library-zip';

function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

function extractPlainText(bytes: Uint8Array): string {
  return decodeBytes(bytes);
}

function extractHtmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
}

function decodeRtfHexByte(hex: string): string {
  const code = Number.parseInt(hex, 16);
  if (Number.isNaN(code)) return '';
  return String.fromCharCode(code);
}

function decodeRtfUnicode(value: string): string {
  const signed = Number.parseInt(value, 10);
  if (Number.isNaN(signed)) return '';
  const code = signed < 0 ? signed + 65536 : signed;
  return String.fromCodePoint(code);
}

function extractRtfText(rtf: string): string {
  let text = '';
  let index = 0;
  let skipDest = 0;

  while (index < rtf.length) {
    const char = rtf[index];
    if (char === '{') {
      index += 1;
      continue;
    }
    if (char === '}') {
      index += 1;
      continue;
    }
    if (char === '\\') {
      index += 1;
      if (index >= rtf.length) break;
      const next = rtf[index];
      if (next === '\\' || next === '{' || next === '}') {
        if (skipDest === 0) text += next;
        index += 1;
        continue;
      }
      if (next === "'") {
        const hex = rtf.slice(index + 1, index + 3);
        if (skipDest === 0) text += decodeRtfHexByte(hex);
        index += 3;
        continue;
      }
      if (next === 'u') {
        const match = /^u(-?\d+)/u.exec(rtf.slice(index));
        if (match) {
          if (skipDest === 0) text += decodeRtfUnicode(match[1] ?? '');
          index += match[0].length;
          if (rtf[index] === '?') index += 1;
          continue;
        }
      }
      const wordMatch = /^[a-z]+(-?\d+)? ?/iu.exec(rtf.slice(index));
      if (wordMatch) {
        const word = wordMatch[0].trim();
        if (word === 'par' || word === 'line') {
          if (skipDest === 0) text += '\n';
        }
        const destMatch =
          /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|footnote)/iu.exec(word);
        if (destMatch) skipDest += 1;
        index += wordMatch[0].length;
        continue;
      }
      index += 1;
      continue;
    }
    if (skipDest === 0) text += char;
    index += 1;
  }

  return text.replace(/\s+/gu, ' ').trim();
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
  return parts.join('\n').replace(/\s+/gu, ' ').trim();
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
  return parts.join('\n').replace(/\s+/gu, ' ').trim();
}

function extractDocxText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parts: string[] = [];
  for (const element of Array.from(
    doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't'),
  )) {
    const content = element.textContent;
    if (content) parts.push(content);
  }
  if (parts.length === 0) {
    return extractXmlText(xml, ['w:t']);
  }
  return parts.join('').replace(/\s+/gu, ' ').trim();
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
  const containerXml = decodeBytes(containerBytes);
  const opfPath = resolveOpfPath(containerXml);
  if (!opfPath) return '';
  const opfBytes = await readZipEntry(data, opfPath);
  if (!opfBytes) return '';
  const opfXml = decodeBytes(opfBytes);
  const hrefs = resolveSpineHrefs(opfXml);
  const parts: string[] = [];
  for (const href of hrefs) {
    const contentPath = joinZipPath(opfPath, href);
    const contentBytes = await readZipEntry(data, contentPath);
    if (!contentBytes) continue;
    const content = decodeBytes(contentBytes);
    parts.push(extractHtmlText(content));
  }
  return parts.join('\n').replace(/\s+/gu, ' ').trim();
}

function isPrintableAscii(char: number): boolean {
  return char >= 32 && char <= 126;
}

function extractOleText(data: Uint8Array): string {
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

  return runs.join('\n').replace(/\s+/gu, ' ').trim();
}

function extensionOf(fileName: string): string {
  const lower = fileName.toLocaleLowerCase('ru-RU');
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot + 1) : '';
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
    return extractRtfText(decodeBytes(bytes));
  }

  if (
    mimeType === 'application/x-fictionbook+xml' ||
    extension === 'fb2' ||
    (extension === 'xml' &&
      bytes.length > 4 &&
      decodeBytes(bytes.slice(0, 100)).includes('<FictionBook'))
  ) {
    return extractFb2Text(decodeBytes(bytes));
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === 'docx'
  ) {
    const documentXml = await readZipEntry(data, 'word/document.xml');
    if (!documentXml) return '';
    return extractDocxText(decodeBytes(documentXml));
  }

  if (mimeType === 'application/epub+zip' || extension === 'epub') {
    return await extractEpubText(data);
  }

  if (mimeType === 'application/msword' || extension === 'doc') {
    return extractOleText(bytes);
  }

  return extractPlainText(bytes);
}
