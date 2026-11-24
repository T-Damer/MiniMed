import type { MedicalCore, MedicalDocument } from '@localmed/contracts';

const PREFERRED_SECTION_RE =
  /^(?:определение|краткое описание|общая информация|аннотация|введение|о заболевании|сущность|значение)/iu;

const NOISE_LINE_RE =
  /^(?:код\s+мкб|мкб-?10|мкб-?11|источник|дата|обновлено|реестр|статус|раздел|глава)\b/iu;

function cleanProseText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/[*_`>#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function trimSummary(text: string, maxChars = 480): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (sentenceEnd >= Math.floor(maxChars * 0.45)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const space = slice.lastIndexOf(' ');
  return `${(space > 120 ? slice.slice(0, space) : slice).trim()}…`;
}

function extractDocumentDefinition(document: MedicalDocument): {
  readonly title: string;
  readonly definition: string;
  readonly anchor?: string;
} | null {
  const canonical = document.metadata?.['canonicalDefinition'];
  if (canonical && typeof canonical === 'object' && !Array.isArray(canonical)) {
    const text = (canonical as Record<string, unknown>)['text'];
    const anchor = (canonical as Record<string, unknown>)['sourceAnchor'];
    if (typeof text === 'string' && text.trim()) {
      return {
        title: document.title,
        definition: trimSummary(cleanProseText(text)),
        ...(typeof anchor === 'string' && anchor.trim() ? { anchor } : {}),
      };
    }
  }

  const orderedSections = [
    ...document.sections.filter(
      (section) =>
        section.sectionType === 'definition' || PREFERRED_SECTION_RE.test(section.title.trim()),
    ),
    ...document.sections.filter(
      (section) =>
        section.sectionType !== 'definition' && !PREFERRED_SECTION_RE.test(section.title.trim()),
    ),
  ];

  const normalizedTitle = document.title.toLocaleLowerCase('ru-RU').trim();
  for (const section of orderedSections) {
    for (const chunk of section.chunks) {
      const text = cleanProseText(chunk.originalText);
      if (text.length < 24) continue;
      if (text.toLocaleLowerCase('ru-RU') === normalizedTitle) continue;
      if (NOISE_LINE_RE.test(text) && text.length < 90) continue;
      return {
        title: document.title,
        definition: trimSummary(text),
        ...(section.anchor ? { anchor: section.anchor } : {}),
      };
    }
  }

  const fallbackMeta = [
    typeof document.metadata?.['shortDescription'] === 'string'
      ? document.metadata['shortDescription']
      : '',
    typeof document.metadata?.['classificationParentTitle'] === 'string'
      ? document.metadata['classificationParentTitle']
      : '',
    typeof document.metadata?.['subtitle'] === 'string' ? document.metadata['subtitle'] : '',
  ]
    .map((item) => cleanProseText(item))
    .filter((item) => item.length >= 6);

  if (fallbackMeta.length > 0) {
    return {
      title: document.title,
      definition: trimSummary(fallbackMeta.join(' · ')),
    };
  }
  return null;
}

export interface LoadedInlineDocumentPreview {
  readonly title: string;
  readonly definition: string;
  readonly documentId: string;
  readonly anchor?: string;
}

/**
 * Lazily loads a definition/summary for an inline document link (e.g. «Стеноз») when the document
 * did not ship with a pre-embedded `canonicalDefinition` in its summary metadata.
 */
export async function loadInlineDocumentPreview(
  core: MedicalCore,
  documentId: string,
  fallbackTitle: string,
): Promise<LoadedInlineDocumentPreview | null> {
  const firstResult = await core.getDocument(documentId);
  const firstDoc = firstResult.ok ? firstResult.value : null;
  if (firstDoc) {
    const direct = extractDocumentDefinition(firstDoc);
    if (direct && firstDoc.sourceType !== 'core_catalog_pointer') {
      return { ...direct, documentId: firstDoc.id };
    }
    const targetId =
      typeof firstDoc.metadata?.['targetDocumentId'] === 'string'
        ? firstDoc.metadata['targetDocumentId']
        : undefined;
    if (targetId && targetId !== firstDoc.id) {
      const targetResult = await core.getDocument(targetId);
      if (targetResult.ok && targetResult.value) {
        const targetPreview = extractDocumentDefinition(targetResult.value);
        if (targetPreview) {
          return { ...targetPreview, documentId: targetResult.value.id };
        }
      }
    }
    if (direct) {
      return { ...direct, documentId: firstDoc.id };
    }
  }

  // Fallback: look up matching definition in installed search/reference docs by title.
  const searchResult = await core.search({
    query: fallbackTitle,
    mode: 'lexical',
    filters: {},
    limit: 4,
    includeSuggestions: false,
  });
  if (searchResult.ok) {
    for (const group of searchResult.value.groups) {
      const snippet = cleanProseText(group.results[0]?.snippet ?? '');
      if (snippet.length >= 30) {
        return {
          title: group.title || fallbackTitle,
          definition: trimSummary(snippet),
          documentId: group.documentId,
        };
      }
    }
  }

  return null;
}
