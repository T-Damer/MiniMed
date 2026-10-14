/**
 * A document's version label as a person would read it. Sources store internal identifiers in the
 * label: a clinical recommendation's `<code>_<edition>` («359_3») and a manufacturer-site text's
 * `site-<hash>`. Those are not edition names and never reach the screen; the edition number of a
 * recommendation does.
 */

const CLINICAL_EDITION_ID = /^\d+_(\d+)$/u;
const INTERNAL_ID = /^(?:site|doc|grls|esklp)-[0-9a-f]{6,}$/iu;
const BARE_HASH = /^(?=.*[a-f])[0-9a-f]{12,}$/iu;

/**
 * What the «Редакция» row shows: «3» for «359_3», the label itself when it reads as a date or a
 * name, `undefined` for an internal identifier.
 */
export function documentEditionValue(label: string | null | undefined): string | undefined {
  const text = label?.trim();
  if (!text) return undefined;
  const edition = CLINICAL_EDITION_ID.exec(text);
  if (edition) return edition[1];
  if (INTERNAL_ID.test(text) || BARE_HASH.test(text)) return undefined;
  return text;
}

/** A short qualifier for a card or a line: «ред. 3» for «359_3»; see {@link documentEditionValue}. */
export function documentVersionLabel(label: string | null | undefined): string | undefined {
  const value = documentEditionValue(label);
  if (value === undefined) return undefined;
  return CLINICAL_EDITION_ID.test(label?.trim() ?? '') ? `ред. ${value}` : value;
}
