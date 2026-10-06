/**
 * Dosage forms a sentence of an instruction names (SAFE1). A restriction often holds for one form
 * only («суспензия — с 2 лет, таблетки — с 6 лет»); the card marks such a sentence with the forms it
 * names so the doctor checks it against the product in hand. Word starts of the registry's own
 * dosage-form vocabulary, not a clinical dictionary.
 */
import { normalizeForLimits } from './age-limits';

export interface DosageFormKind {
  readonly bit: number;
  readonly label: string;
  readonly pattern: RegExp;
}

const START = '(?<![\\p{L}\\d])';

export const DOSAGE_FORM_KINDS: readonly DosageFormKind[] = [
  {
    bit: 1,
    label: 'таблетки',
    pattern: new RegExp(`${START}(?:таблет|драже|пастилк|леденц)`, 'u'),
  },
  { bit: 2, label: 'капсулы', pattern: new RegExp(`${START}капсул`, 'u') },
  {
    bit: 4,
    label: 'суспензия, сироп, раствор для приёма внутрь',
    pattern: new RegExp(
      `${START}(?:суспенз|сироп|эликсир|гранул\\p{L}*\\s+для\\s+приготовления|порошок\\s+для\\s+приготовления\\s+(?:суспенз|раствор\\p{L}*\\s+для\\s+приема)|раствор\\p{L}*\\s+для\\s+приема\\s+внутрь|капли\\s+для\\s+приема\\s+внутрь)`,
      'u',
    ),
  },
  {
    bit: 8,
    label: 'инъекции, инфузии',
    pattern: new RegExp(
      `${START}(?:инъекц|инфузи|ампул|внутривенн|внутримышечн|подкожн|парентеральн|лиофилизат)`,
      'u',
    ),
  },
  {
    bit: 16,
    label: 'наружные формы',
    pattern: new RegExp(
      `${START}(?:мазь|мази|мазью|крем|гель|геля|гелем|пластыр|линимент|наружн|накожн|трансдермальн)`,
      'u',
    ),
  },
  {
    bit: 32,
    label: 'ингаляции, спреи, аэрозоли',
    pattern: new RegExp(
      `${START}(?:ингаляц|аэрозол|спрей|небулайзер|дозированн\\p{L}*\\s+порошок)`,
      'u',
    ),
  },
  {
    bit: 64,
    label: 'свечи, вагинальные формы',
    pattern: new RegExp(`${START}(?:суппозитор|свеч|ректальн|вагинальн|пессари)`, 'u'),
  },
  {
    bit: 128,
    label: 'капли, глазные и ушные формы',
    pattern: new RegExp(`${START}(?:капли|капель|глазн|ушн|интраназальн|назальн)`, 'u'),
  },
];

/** Bit mask of the dosage forms `text` names. */
export function detectDosageForms(text: string): number {
  const normalized = normalizeForLimits(text);
  let mask = 0;
  for (const kind of DOSAGE_FORM_KINDS) if (kind.pattern.test(normalized)) mask |= kind.bit;
  return mask;
}

export function dosageFormLabels(mask: number): readonly string[] {
  return DOSAGE_FORM_KINDS.filter((kind) => (mask & kind.bit) !== 0).map((kind) => kind.label);
}
