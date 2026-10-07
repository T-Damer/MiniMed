/** Title and author a book file declares about itself (EPUB package metadata, FB2 title-info). */
export interface UserLibraryEmbeddedMetadata {
  readonly title?: string;
  readonly author?: string;
}

/** Same limit as a name the user types (`USER_LIBRARY_NAME_MAX_LENGTH`). */
const METADATA_TEXT_MAX_LENGTH = 256;

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return XML_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Plain text of an XML fragment: tags and CDATA wrappers removed, entities decoded, spaces folded. */
function xmlText(fragment: string): string | undefined {
  const text = decodeEntities(
    fragment
      // CDATA is literal text: protect its markup characters, drop every real tag.
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>|<[^>]*>/gu, (_match, cdata: string | undefined) =>
        cdata === undefined
          ? ' '
          : cdata.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;'),
      )
      .replaceAll('\u0000', ''),
  )
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) return undefined;
  const characters = [...text];
  return characters.length > METADATA_TEXT_MAX_LENGTH
    ? `${characters.slice(0, METADATA_TEXT_MAX_LENGTH - 1).join('')}…`
    : text;
}

function elementTexts(xml: string, localName: string): readonly string[] {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}\\s*>`,
    'giu',
  );
  const texts: string[] = [];
  for (const match of xml.matchAll(pattern)) {
    const text = xmlText(match[1] ?? '');
    if (text) texts.push(text);
  }
  return texts;
}

function joinAuthors(authors: readonly string[]): string | undefined {
  const unique = [...new Set(authors)];
  if (unique.length === 0) return undefined;
  const joined = unique.join(', ');
  return [...joined].length > METADATA_TEXT_MAX_LENGTH
    ? `${[...joined].slice(0, METADATA_TEXT_MAX_LENGTH - 1).join('')}…`
    : joined;
}

function metadataOf(title: string | undefined, author: string | undefined) {
  return {
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
  } satisfies UserLibraryEmbeddedMetadata;
}

/** `dc:title` and `dc:creator` of an EPUB package document (the `.opf`). */
export function parseEpubPackageMetadata(opfXml: string): UserLibraryEmbeddedMetadata {
  const metadataBlock =
    /<(?:[\w.-]+:)?metadata(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?metadata\s*>/iu.exec(opfXml);
  const scope = metadataBlock?.[1] ?? opfXml;
  return metadataOf(elementTexts(scope, 'title')[0], joinAuthors(elementTexts(scope, 'creator')));
}

/** `book-title` and the authors of an FB2 `title-info`. */
export function parseFb2Metadata(xml: string): UserLibraryEmbeddedMetadata {
  const titleInfo = /<title-info(?:\s[^>]*)?>([\s\S]*?)<\/title-info\s*>/iu.exec(xml)?.[1];
  if (!titleInfo) return {};
  const authors = [...titleInfo.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author\s*>/giu)].flatMap(
    (match) => {
      const body = match[1] ?? '';
      const name = [
        elementTexts(body, 'first-name')[0],
        elementTexts(body, 'middle-name')[0],
        elementTexts(body, 'last-name')[0],
      ]
        .filter(Boolean)
        .join(' ');
      return name ? [name] : [];
    },
  );
  return metadataOf(elementTexts(titleInfo, 'book-title')[0], joinAuthors(authors));
}

/** The name a file gets in the library before anyone renames it: the file name without extension. */
export function defaultUserLibraryTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, '').trim() || fileName;
}

/**
 * The title to store once a book's own title is known: it replaces the file-name title only while
 * the user has not renamed the file.
 */
export function titleFromEmbeddedMetadata(
  document: { readonly title: string; readonly fileName: string },
  metadata: UserLibraryEmbeddedMetadata,
): string | undefined {
  if (!metadata.title) return undefined;
  if (document.title !== defaultUserLibraryTitle(document.fileName)) return undefined;
  return metadata.title === document.title ? undefined : metadata.title;
}
