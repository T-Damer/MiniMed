import type { MedicalDocumentSummary, MedicalSection } from '@localmed/contracts';
import {
  fullDocumentCandidateId,
  fullDocumentCandidateIds,
  hasFullTextSibling,
  isSameDocumentFamily,
  isSupersededSummaryDocument,
  resolveReadableDocumentId,
  summaryDocumentId,
} from '@localmed/core';

import {
  isClinicalRecommendationSource,
  promoteNumberedHeadingSections,
} from '@/features/library/numbered-heading-sections';
import { isSectionTitleEcho } from '@/features/library/reader-text-normalization';
import { browserI18n } from '@/i18n/browser-i18n';
import { sourceTypeReaderLabel as localizedSourceTypeReaderLabel } from '@/i18n/labels';

const REGISTRY_SECTION_PATTERN = /регистрационн|ограничен/i;

export type DocumentSectionHeadingTag = 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface DocumentSectionTree {
  readonly section: MedicalSection;
  readonly children: readonly DocumentSectionTree[];
}

export type MutableDocumentSectionTree = {
  readonly section: MedicalSection;
  children: DocumentSectionTree[];
};

export {
  fullDocumentCandidateId,
  fullDocumentCandidateIds,
  hasFullTextSibling,
  isSameDocumentFamily,
  isSupersededSummaryDocument,
  resolveReadableDocumentId,
  summaryDocumentId,
};

const CYRILLIC = /[А-Яа-яЁё]/u;

/**
 * The short title a document is shown under. A reference monograph of a drug (Allmed) keeps its
 * Latin name in the short title («Theraflu») beside the Russian trade name in the title
 * («Терафлю»); the Russian name is what the search result was called, so it is what opens.
 */
function readableShortTitle(
  document: Pick<MedicalDocumentSummary, 'title' | 'shortTitle' | 'sourceType'>,
): string | undefined {
  const short = document.shortTitle ?? undefined;
  if (
    short !== undefined &&
    document.sourceType === 'allmed_reference' &&
    !CYRILLIC.test(short) &&
    CYRILLIC.test(document.title)
  ) {
    return undefined;
  }
  return short;
}

export function displayDocumentTitle(
  document: Pick<MedicalDocumentSummary, 'title' | 'shortTitle' | 'sourceType' | 'metadata'>,
): string {
  if (document.sourceType === 'official_registry_summary') {
    const inn = document.title.split('—')[0]?.trim();
    if (inn) return inn;
  }
  const title = readableShortTitle(document) ?? document.title;
  const metadata = document.metadata;
  const code = metadata?.['mkbCode'];
  const path = metadata?.['classificationPath'];
  const parent: unknown = Array.isArray(path) ? path[0] : undefined;
  if (
    (document.sourceType === 'rls_mkb_reference' ||
      metadata?.['sourceType'] === 'rls_mkb_reference') &&
    typeof code === 'string' &&
    code.includes('.') &&
    parent &&
    typeof parent === 'object' &&
    'title' in parent &&
    typeof parent.title === 'string' &&
    parent.title.trim()
  ) {
    const prefix = `${code} `;
    const subject = title.startsWith(prefix) ? title.slice(prefix.length) : title;
    return `${prefix}${parent.title.trim()} — ${subject}`;
  }
  return title;
}

/**
 * A list with no query opens on names a doctor knows: titles that begin with a letter come first,
 * those that begin with a digit, bracket or sign (chemical names like «1-(4-БРОМФЕНИЛ)…») follow,
 * each group in the order the catalog gave.
 */
export function wordTitlesFirst(
  documents: readonly MedicalDocumentSummary[],
): readonly MedicalDocumentSummary[] {
  const startsWithLetter = (document: MedicalDocumentSummary): boolean =>
    /^\p{L}/u.test(displayDocumentTitle(document).trim());
  const words = documents.filter(startsWithLetter);
  return words.length === 0 || words.length === documents.length
    ? documents
    : [...words, ...documents.filter((document) => !startsWithLetter(document))];
}

export function displayDocumentSubtitle(
  document: Pick<MedicalDocumentSummary, 'title' | 'sourceType'>,
): string | null {
  if (document.sourceType === 'official_registry_summary') {
    const form = document.title.split('—').slice(1).join('—').trim();
    return form.length > 0 ? form : browserI18n.getMessage('source_registry_reader_subtitle');
  }
  return null;
}

export function sourceTypeReaderLabel(sourceType: string): string | null {
  return localizedSourceTypeReaderLabel(sourceType);
}

export function documentSectionHeadingTag(
  depth: number,
  documentTitleLevel: 1 | 2 = 1,
): DocumentSectionHeadingTag {
  const level = Math.min(6, Math.max(2, depth + documentTitleLevel));
  switch (level) {
    case 2:
      return 'h2';
    case 3:
      return 'h3';
    case 4:
      return 'h4';
    case 5:
      return 'h5';
    default:
      return 'h6';
  }
}

export function nestDocumentSections(
  sections: readonly MedicalSection[],
  nodeCache?: Map<MedicalSection, MutableDocumentSectionTree>,
): readonly DocumentSectionTree[] {
  const roots: DocumentSectionTree[] = [];
  const stack: Array<{ depth: number; node: MutableDocumentSectionTree }> = [];

  const resolveNode = (section: MedicalSection): MutableDocumentSectionTree => {
    if (!nodeCache) return { section, children: [] };
    let node = nodeCache.get(section);
    if (!node) {
      node = { section, children: [] };
      nodeCache.set(section, node);
    }
    node.children = [];
    return node;
  };

  for (const section of sections) {
    const node = resolveNode(section);
    let parent = stack.at(-1);
    while (parent && parent.depth >= section.depth) {
      stack.pop();
      parent = stack.at(-1);
    }
    if (parent) {
      parent.node.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ depth: section.depth, node });
  }

  return roots;
}

/**
 * Registration details (number, holder, restrictions of a registry card) matter for audit, not for
 * treatment: medication readers show them last, in small print. The data marks them with the
 * `registration` section type; registry cards without that type are recognised by their headings.
 */
export function isAdministrativeMedicationSection(
  section: Pick<MedicalSection, 'title' | 'sectionType'>,
  sourceType: string,
): boolean {
  if (!MEDICATION_READER_SOURCE_TYPES.has(sourceType)) return false;
  if (section.sectionType === 'registration') return true;
  return sourceType === 'official_registry_summary' && REGISTRY_SECTION_PATTERN.test(section.title);
}

/**
 * Sections a catalog card carries about itself (names, codes, identifiers, where the full text
 * lives). Readers keep them after the document's own text in small print; search shows their
 * fragments after the document's own ones.
 */
export const TECHNICAL_SECTION_TITLES: ReadonlySet<string> = new Set([
  'Сведения о документе',
  'Сведения МКБ-10',
  'Классификационный контекст',
  'Ограничение покрытия',
]);

/**
 * Sections whose catalogue wording is cleaned (storage note, empty fields, identifiers) but which
 * stay in place: a drug pointer's «Указатель препарата» carries the drug's МНН, its most useful line.
 */
export const CLEANED_SECTION_TITLES: ReadonlySet<string> = new Set([
  ...TECHNICAL_SECTION_TITLES,
  'Указатель препарата',
]);

export function isTechnicalSection(section: Pick<MedicalSection, 'title'>): boolean {
  return TECHNICAL_SECTION_TITLES.has(section.title.trim());
}

/** Registration details of a medication or a card's technical section: last and in small print. */
export function isAdministrativeSection(
  section: Pick<MedicalSection, 'title' | 'sectionType'>,
  sourceType: string,
): boolean {
  return isAdministrativeMedicationSection(section, sourceType) || isTechnicalSection(section);
}

export function orderDocumentSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  const primary = sections.filter((section) => !isAdministrativeSection(section, sourceType));
  // A card made only of technical sections keeps its order: there is nothing to put first.
  if (primary.length === sections.length || primary.length === 0) return sections;
  const administrative = sections.filter((section) => isAdministrativeSection(section, sourceType));
  return [...primary, ...administrative];
}

const REDUNDANT_MEDICATION_SECTION_TITLE = 'Карточка препарата';
/** A statement about what the app's index lacks; it tells a doctor nothing about the code or drug. */
const COVERAGE_NOTE_SECTION_TITLE = 'Ограничение покрытия';
const MEDICATION_READER_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'allmed_reference',
  'official_drug_instruction',
  'official_registry_summary',
]);

/** A glossary the recommendation template puts first; it is reference, not the start of the text. */
const GLOSSARY_SECTION_TITLE = /^список сокращений\.?$/iu;

/**
 * The reader opens on the text itself: the abbreviation list that clinical recommendations carry
 * before their first chapter moves, with its subsections, behind the chapters.
 */
export function glossaryLast(sections: readonly MedicalSection[]): readonly MedicalSection[] {
  if (sections.length === 0) return sections;
  const rootDepth = Math.min(...sections.map((section) => section.depth));
  const blocks: MedicalSection[][] = [];
  for (const section of sections) {
    if (section.depth <= rootDepth || blocks.length === 0) blocks.push([section]);
    else blocks.at(-1)?.push(section);
  }
  const isGlossary = (block: readonly MedicalSection[]): boolean =>
    GLOSSARY_SECTION_TITLE.test(block[0]?.title.trim() ?? '');
  return blocks.some(isGlossary) ? reordered(blocks, isGlossary) : sections;
}

function reordered(
  blocks: readonly (readonly MedicalSection[])[],
  isGlossary: (block: readonly MedicalSection[]) => boolean,
): readonly MedicalSection[] {
  return [
    ...blocks.filter((block) => !isGlossary(block)).flat(),
    ...blocks.filter(isGlossary).flat(),
  ];
}

/**
 * Page stamps the PDF text kept as headings of an official instruction: «ИНСТРУКЦИЯ», «ПО
 * МЕДИЦИНСКОМУ ПРИМЕНЕНИЮ ЛЕКАРСТВЕННОГО ПРЕПАРАТА», «МЗ РФ», «СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ»,
 * «ЛП-№(000403)-(РГ-RU)-281021», «(ПОСЛЕДОВАТЕЛЬНОСТЬ 0001)». They are not sections: each cut the
 * section it fell into in two.
 */
const PAGE_STAMP_TITLE = new RegExp(
  [
    '\\(?\\s*ПОСЛЕДОВАТЕЛЬНОСТЬ\\s+\\d+\\s*\\)?',
    'ИНСТРУКЦИЯ\\s*\\(?\\s*(?:ПО)?СЛЕДОВАТЕЛЬНОСТЬ\\s+\\d+\\s*\\)?',
    'ИНСТРУКЦИЯ\\s*(?:\\(?\\s*ПОСЛЕДОВАТЕЛЬНОСТЬ\\s+\\d+\\s*\\)?)?(?:\\s*ПО\\s+МЕДИЦИНСКОМУ\\s+ПРИМЕНЕНИЮ(?:\\s+ЛЕКАРСТВЕННОГО(?:\\s+ПРЕПАРАТА)?)?)?',
    'ПО\\s+МЕДИЦИНСКОМУ\\s+ПРИМЕНЕНИЮ(?:\\s+ЛЕКАРСТВЕННОГО(?:\\s+ПРЕПАРАТА)?)?',
    'ЛЕКАРСТВЕННОГО\\s+ПРЕПАРАТА',
    'МИНИСТЕРСТВО\\s+ЗДРАВООХРАНЕНИЯ(?:\\s+[А-ЯЁ\\s]+)?',
    'МИНЗДРАВ\\s+РОССИ[ИЙ]',
    '[МM]\\s?[З3]\\s+РФ',
    'СОГЛАСОВАНО',
    '(?:[А-ЯЁA-Z.•]+\\s*){0,2}ЭКС[А-ЯЁ]*\\s+ОТЧ[ЕЁ]Т[А-ЯЁ]*',
    'ДЕЙСТВИТЕЛЕН\\s+ДЛЯ\\s+ДАННОЙ',
    'В?\\s*ДЕЙСТВУТЕЛЕН\\s+ДЛЯ\\s+ДАННОЙ',
    'ВЕРСИИ\\s+ДОКУМЕНТА',
    'НЦЭСМП',
    '[ЛJ][ПTIІЛJ]{1,3}\\s*-?\\s*[NМM#№G][\\s\\S]*',
    // EAEU stamps, also as OCR mangled them: «ЛП-№004387-ГП-ВУ», «лп-шOOдт 06-гп -ву».
    '[ЛJ][ПN]\\s*-[\\s\\S]{0,24}-\\s*Г\\s*П\\s*-?\\s*[ВB]\\s*[УY][\\s\\S]*',
    // «соответствует экспертному отчету» as OCR mangled it: «соотвЕтсгвуЕт э кспЕртноfilу отч Ету».
    'СО[\\s\\S]{0,14}(?:Э\\s*)?КСП\\s*Е\\s*Р\\s*Т[\\s\\S]*',
    // Page headers and signature stamps: «SPC.063.1.EAEU-RU.02.02 С. 4», «РУС" | 11:39:04 +03'00».
    'SPC[.\\d][\\s\\S]*',
    "[\\s\\S]*\\d{2}:\\d{2}:\\d{2}\\s*[+-]\\d{2}['’]?\\d{2}[\\s\\S]*",
  ]
    .map((pattern) => `(?:${pattern})`)
    .join('|')
    .replace(/^/u, '^(?:')
    .concat(')$'),
  'iu',
);

function isPageStamp(section: MedicalSection): boolean {
  return (
    (section.sectionType === null || section.sectionType === 'other') &&
    PAGE_STAMP_TITLE.test(section.title.trim().replace(/\s+/gu, ' '))
  );
}

/**
 * An instruction's page stamps fold into the text around them: their paragraphs continue the
 * section before them (the ones before the first section open it). No paragraph is dropped.
 */
export function foldPageStamps(sections: readonly MedicalSection[]): readonly MedicalSection[] {
  if (!sections.some(isPageStamp)) return sections;
  const folded: MedicalSection[] = [];
  let leading: MedicalSection['chunks'][number][] = [];
  for (const section of sections) {
    if (isPageStamp(section)) {
      const previous = folded.at(-1);
      if (!previous) leading = [...leading, ...section.chunks];
      else if (section.chunks.length > 0)
        folded[folded.length - 1] = {
          ...previous,
          chunks: [...previous.chunks, ...section.chunks],
        };
      continue;
    }
    if (folded.length === 0 && leading.length > 0) {
      folded.push({ ...section, chunks: [...leading, ...section.chunks] });
      leading = [];
      continue;
    }
    folded.push(section);
  }
  return folded;
}

/**
 * A heading of an instruction that is no heading (FMT-AUDIT): the tail of a sentence the PDF split
 * at a page or column («лечение.», «для приготовления раствора для инфузий»), or a table cell
 * («300 АЕ* 1000 АЕ*», «V03AB25»). Its text joins the section before it as a line of its own, so
 * nothing is lost, and its paragraphs continue that section.
 */
function isFragmentHeading(section: MedicalSection): boolean {
  if (section.sectionType === 'registration') return false;
  const title = section.title.trim();
  return (
    /^[\p{Ll}]/u.test(title) ||
    !/[\p{L}]{3,}/u.test(title.replace(/\b[A-Z]\d{2}[A-Z]{0,2}\d{0,2}\b/gu, ''))
  );
}

export function foldFragmentHeadings(
  sections: readonly MedicalSection[],
): readonly MedicalSection[] {
  if (!sections.some(isFragmentHeading)) return sections;
  const folded: MedicalSection[] = [];
  for (const section of sections) {
    const previous = folded.at(-1);
    if (!previous || !isFragmentHeading(section)) {
      folded.push(section);
      continue;
    }
    const titleLine: MedicalSection['chunks'][number] = {
      id: `${section.id}:title`,
      sectionId: previous.id,
      documentVersionId: section.documentVersionId,
      orderIndex: section.orderIndex,
      originalText: section.title.trim(),
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
      anchor: section.anchor,
    };
    folded[folded.length - 1] = {
      ...previous,
      chunks: [...previous.chunks, titleLine, ...section.chunks],
    };
  }
  return folded;
}

/**
 * The same heading twice in a row at one depth («Фармакокинетика» / «Фармакокинетика»: a page break
 * of the source) is one section: the second one's text continues the first.
 */
function mergeRepeatedHeadings(sections: readonly MedicalSection[]): readonly MedicalSection[] {
  const key = (section: MedicalSection) =>
    `${String(section.depth)}|${section.title
      .trim()
      .replace(/[\s:.]+$/u, '')
      .toLocaleLowerCase('ru-RU')}`;
  const merged: MedicalSection[] = [];
  for (const section of sections) {
    const previous = merged.at(-1);
    if (previous && key(previous) === key(section)) {
      merged[merged.length - 1] = { ...previous, chunks: [...previous.chunks, ...section.chunks] };
    } else merged.push(section);
  }
  return merged;
}

/**
 * The manufacturer and the organisation receiving claims of a drug instruction: reference data,
 * not reading (owner 2026-11-06). They leave the page for «⋯» → «Информация». Matched by the
 * section's kind and title, never by document: «Торговое наименование» and «Регистрационный номер»
 * are `registration` sections too and stay.
 */
const REGISTRATION_REFERENCE_TITLE = /производител|принимающ\p{L}*\s+претензи/iu;

function isRegistrationReferenceSection(section: MedicalSection): boolean {
  return (
    section.sectionType === 'registration' &&
    REGISTRATION_REFERENCE_TITLE.test(section.title.replace(/[\s:*]+$/u, ''))
  );
}

/** The registration reference sections of a drug instruction, with the sections nested in them. */
function splitRegistrationReference(sections: readonly MedicalSection[]): {
  readonly reading: readonly MedicalSection[];
  readonly reference: readonly MedicalSection[];
} {
  const reading: MedicalSection[] = [];
  const reference: MedicalSection[] = [];
  let insideDepth: number | null = null;
  for (const section of sections) {
    if (insideDepth !== null && section.depth > insideDepth) {
      reference.push(section);
      continue;
    }
    insideDepth = null;
    if (isRegistrationReferenceSection(section)) {
      insideDepth = section.depth;
      reference.push(section);
    } else reading.push(section);
  }
  return { reading, reference };
}

/** What «Информация» shows of the instruction's own text: manufacturer, claims (empty elsewhere). */
export function registrationReferenceSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  if (sourceType !== 'official_drug_instruction') return [];
  return splitRegistrationReference(foldPageStamps(sections)).reference.filter(
    (section) => section.chunks.length > 0,
  );
}

export function visibleReaderSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  const source =
    sourceType === 'official_drug_instruction'
      ? foldFragmentHeadings(splitRegistrationReference(foldPageStamps(sections)).reading)
      : sections;
  const ordered = (
    isClinicalRecommendationSource(sourceType)
      ? glossaryLast(orderDocumentSections(source, sourceType))
      : orderDocumentSections(source, sourceType)
  ).filter(
    (section) =>
      section.title.trim() !== COVERAGE_NOTE_SECTION_TITLE &&
      !(
        MEDICATION_READER_SOURCE_TYPES.has(sourceType) &&
        section.title === REDUNDANT_MEDICATION_SECTION_TITLE
      ),
  );
  // A section without text of its own stays when it heads deeper sections that have text: a chapter
  // («3. Лечение») is the parent of its subsections. Dropped, its children nested under whatever
  // section came before it and the chapter vanished from the page and the contents.
  // A chunk that only repeats its heading («Состав» under «Состав») is no text of its own: the
  // reader draws nothing for it, and the section would show as an empty duplicate heading.
  const hasText = (section: MedicalSection) =>
    section.chunks.some((chunk) => !isSectionTitleEcho(chunk.originalText, section.title));
  const visible = ordered.filter((section, index) => {
    if (hasText(section)) return true;
    for (const next of ordered.slice(index + 1)) {
      if (next.depth <= section.depth) return false;
      if (hasText(next)) return true;
    }
    return false;
  });
  // Sub-headings the source kept as numbered paragraphs become sections of the reader. After the
  // filter above: a section left without its own text still shows its title.
  const single = mergeRepeatedHeadings(visible);
  return isClinicalRecommendationSource(sourceType)
    ? promoteNumberedHeadingSections(single)
    : single;
}

export function isFullTextDocumentId(documentId: string): boolean {
  return documentId.endsWith('.full');
}

export function preferReadableDocuments(
  documents: readonly MedicalDocumentSummary[],
): readonly MedicalDocumentSummary[] {
  const availableIds = new Set(documents.map((document) => document.id));
  return documents.filter((document) => !isSupersededSummaryDocument(document.id, availableIds));
}
