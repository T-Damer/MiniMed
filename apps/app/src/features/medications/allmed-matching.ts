/**
 * Which Allmed reference entry may be shown with which registry product. The link is exact:
 * the same ЕСКЛП substance (the Allmed entry's `linkedMnnDocumentId`), the same trade name, and a
 * dosage form that does not contradict the product's. An Allmed entry for one trade name often
 * lists several forms in one text, so a form only rules an entry out when both sides name forms
 * and share none of them. Nothing is matched across different substances or by similarity.
 */
import type { MedicationProduct } from '@/features/medications/medication-record';

export type DosageFormClass =
  | 'oral-solid'
  | 'oral-liquid'
  | 'injection'
  | 'topical'
  | 'eye'
  | 'ear'
  | 'nasal'
  | 'inhalation'
  | 'rectal'
  | 'vaginal';

const FORM_PATTERNS: readonly (readonly [DosageFormClass, RegExp])[] = [
  [
    'injection',
    /инъекц|инфузи|лиофилизат|ампул|шприц|для\s+(?:внутривенного|внутримышечного|подкожного)/u,
  ],
  ['eye', /глазн|для\s+глаз|офтальм/u],
  ['ear', /ушн|для\s+ушей|отиче/u],
  ['nasal', /назальн|в\s+нос|для\s+носа|интраназальн/u],
  ['inhalation', /ингаляц|небулайзер/u],
  ['rectal', /суппозитор|свеч|ректальн/u],
  ['vaginal', /вагинальн|пессари/u],
  ['topical', /мазь|крем|гель|линимент|паста|пластыр|присыпк|лосьон|шампун|наружн|аэрозол|спрей/u],
  [
    'oral-liquid',
    /сироп|суспензи|эликсир|настойк|(?:раствор|р-р|капли)[^.;\n]*(?:внутрь|приема\s+внутрь|перорал)|капли\s+для\s+приема/u,
  ],
  ['oral-solid', /таблет|табл\.|капсул|капс\.|драже|пастилк|гранул/u],
];

/** Dosage form classes named in a form text (ЕСКЛП uppercase or Allmed free text). */
export function dosageFormClasses(text: string | null | undefined): ReadonlySet<DosageFormClass> {
  const normalized = (text ?? '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const found = new Set<DosageFormClass>();
  if (!normalized.trim()) return found;
  for (const [formClass, pattern] of FORM_PATTERNS) {
    if (pattern.test(normalized)) found.add(formClass);
  }
  return found;
}

function tradeNameKey(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[®™©]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

type MatchedProduct = Pick<MedicationProduct, 'mnnDocumentId' | 'tradeName' | 'presentations'>;

/** False only when both sides name dosage forms and they have no class in common. */
export function dosageFormsCompatible(
  product: Pick<MedicationProduct, 'presentations'>,
  allmed: Pick<MedicationProduct, 'presentations'>,
): boolean {
  const productClasses = new Set(
    product.presentations.flatMap((presentation) => [
      ...dosageFormClasses(presentation.dosageForm),
    ]),
  );
  const allmedClasses = new Set(
    allmed.presentations.flatMap((presentation) => [...dosageFormClasses(presentation.dosageForm)]),
  );
  if (productClasses.size === 0 || allmedClasses.size === 0) return true;
  return [...productClasses].some((formClass) => allmedClasses.has(formClass));
}

export function allmedMatchesProduct(product: MatchedProduct, allmed: MedicationProduct): boolean {
  return (
    allmed.sourceKind === 'allmed' &&
    product.mnnDocumentId !== null &&
    allmed.linkedMnnDocumentId === product.mnnDocumentId &&
    tradeNameKey(allmed.tradeName) === tradeNameKey(product.tradeName) &&
    dosageFormsCompatible(product, allmed)
  );
}
