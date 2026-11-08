/**
 * Sources behind a tool, as the «?» help lists them (owner 2026-11-08): a named source — title,
 * publisher, year — that opens inside the app when the app has the document (a КР in the reader),
 * otherwise on its site under the site's name, never as a long raw address.
 */
export interface HelpSource {
  /** The source as its schema writes it; a long citation is shortened for the row. */
  readonly title: string;
  readonly publisher?: string | undefined;
  /** Year or edition («2024», «v3.8»). */
  readonly year?: string | undefined;
  /** Where in the source («приложение Г1; разделы 3.1, 6.1»). */
  readonly detail?: string | undefined;
  readonly url?: string | undefined;
  /** The document in the app's own corpus: opens in the reader instead of the site. */
  readonly document?:
    | {
        readonly moduleId?: string | null | undefined;
        readonly documentId: string;
        readonly anchor?: string | null | undefined;
      }
    | undefined;
}

/** What one source row shows. */
export interface HelpSourceRow {
  /** «КР», «Статья»…: the kind of source, when the title says it. */
  readonly kind: string | undefined;
  /** The source's own name, without its kind, authors or locators. */
  readonly name: string;
  /** «Минздрав России · 2024» — who and when, one quiet line. */
  readonly meta: string;
  /** The site a link opens on, by name («PubMed»); undefined for an in-app document. */
  readonly site: string | undefined;
}

const KNOWN_SITES: Readonly<Record<string, string>> = {
  'pubmed.ncbi.nlm.nih.gov': 'PubMed',
  'ncbi.nlm.nih.gov': 'NCBI',
  'cr.minzdrav.gov.ru': 'Рубрикатор КР',
  'publication.pravo.gov.ru': 'Официальное опубликование',
  'doi.org': 'DOI',
  'who.int': 'ВОЗ',
  'cdc.gov': 'CDC',
  'nice.org.uk': 'NICE',
  'ahajournals.org': 'AHA Journals',
  'jacc.org': 'JACC',
  'sudact.ru': 'СудАкт',
  'consultant.ru': 'КонсультантПлюс',
  'garant.ru': 'Гарант',
};

/** The name of the site a link leads to: a known name or the bare host. */
export function sourceSiteName(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return undefined;
  }
  if (!host) return undefined;
  for (const [domain, name] of Object.entries(KNOWN_SITES)) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  return host;
}

/** «Министерство здравоохранения Российской Федерации» reads as «Минздрав России». */
const PUBLISHER_NAMES: Readonly<Record<string, string>> = {
  'Министерство здравоохранения Российской Федерации': 'Минздрав России',
  'Минздрав РФ': 'Минздрав России',
};

const KR_PREFIX = /^Клинические рекомендации\s*(?::\s*|«)/u;
/** «Sullivan JT, Sykora K, Naranjo CA. Title» — Vancouver-style authors before the title. */
const VANCOUVER_AUTHORS =
  /^((?:[\p{Lu}][\p{L}'’-]+(?: [\p{Lu}][\p{L}'’-]+)* [\p{Lu}]{1,3}(?:, |\. ))+)(.+)$/u;
/** «(Минздрав России, 2024, ID 784)» / «(КР 306_3)»: kind, publisher and id in brackets. */
const KR_BRACKET = /\s*\((?:[^()]*?(?:ID|КР)\s*[\d_]+[^()]*?)\)/u;
const YEAR = /(?:^|[\s(,])((?:19|20)\d{2})(?=[\s),.]|$)/u;

function stripQuotes(text: string): string {
  const trimmed = text.trim();
  // «Name» (with nested «…» inside) — drop only the outer pair.
  if (trimmed.startsWith('«')) {
    let depth = 0;
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (char === '«') depth += 1;
      else if (char === '»') {
        depth -= 1;
        if (depth === 0) {
          return `${trimmed.slice(1, index)}${trimmed.slice(index + 1)}`.trim();
        }
      }
    }
  }
  return trimmed;
}

/**
 * Splits a КР citation into its name and its locator: «Клинические рекомендации «X» (Минздрав
 * России, 2024, ID 784), приложение Г1» → «X» and «приложение Г1».
 */
function clinicalRecommendationName(title: string): { name: string; locator?: string } {
  let rest = title.replace(KR_PREFIX, (match) => (match.endsWith('«') ? '«' : ''));
  if (rest.startsWith('«')) {
    let depth = 0;
    for (let index = 0; index < rest.length; index += 1) {
      const char = rest[index];
      if (char === '«') depth += 1;
      else if (char === '»') {
        depth -= 1;
        if (depth === 0) {
          const name = rest.slice(1, index).trim();
          const tail = rest
            .slice(index + 1)
            .replace(KR_BRACKET, '')
            .replace(/^\s*\([^()]*\)/u, '')
            .replace(/^[\s,.:;—–-]+/u, '')
            .trim();
          return tail ? { name, locator: tail } : { name };
        }
      }
    }
  }
  rest = rest.replace(KR_BRACKET, '');
  const [name = rest, ...locator] = rest.split(/,\s*(?=приложение|раздел|таблиц|с\.\s)/u);
  const tail = locator.join(', ').trim();
  return tail ? { name: name.trim(), locator: tail } : { name: name.trim() };
}

/** One row of the «Источники» list: a clean name, who and when, and the site it opens on. */
export function helpSourceRow(source: HelpSource): HelpSourceRow {
  const title = source.title.trim();
  let kind: string | undefined;
  let name = title;
  let authors: string | undefined;
  let locator: string | undefined;
  if (KR_PREFIX.test(title)) {
    kind = 'КР';
    const parsed = clinicalRecommendationName(title);
    name = parsed.name;
    locator = parsed.locator;
  } else {
    const vancouver = VANCOUVER_AUTHORS.exec(title);
    if (vancouver?.[1] && vancouver[2]) {
      const list = vancouver[1].replace(/[.,]\s*$/u, '').split(/,\s*/u);
      authors = list.length > 1 ? `${list[0]} и соавт.` : list[0];
      name = vancouver[2].trim();
    }
    name = stripQuotes(name);
  }
  const publisher = source.publisher
    ? (PUBLISHER_NAMES[source.publisher.trim()] ?? source.publisher.trim())
    : undefined;
  const year = source.year?.trim() || YEAR.exec(title)?.[1];
  const meta = [authors, publisher, year, source.detail ?? locator]
    .filter((part): part is string => Boolean(part?.trim()))
    // A publisher that is already in the name (a journal named in the title) is not repeated.
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(' · ');
  const site = source.document ? undefined : source.url ? sourceSiteName(source.url) : undefined;
  return { kind, name: name.replace(/[.\s]+$/u, ''), meta, site };
}
