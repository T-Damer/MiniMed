import { displayDrugName } from '@/features/medications/drug-screen';

/**
 * Drug labels made of a product and its substance («Нурофен · Ибупрофен»). A product that is just
 * the substance's name («Ацетилсалициловая кислота · АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА») is one name, not
 * two: it is written once.
 */

const SEPARATOR = ' · ';

function nameKey(name: string): string {
  return name.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

export function sameDrugName(first: string, second: string): boolean {
  return nameKey(first) === nameKey(second);
}

/** «Продукт · Вещество», or the one name when both are the same. */
export function joinProductAndSubstance(product: string | null, substance: string): string {
  if (!product || sameDrugName(product, substance)) return substance;
  return `${product}${SEPARATOR}${substance}`;
}

/** A search title as the doctor reads it: the part before «:» and no repeated names. */
export function drugLabelOfTitle(title: string): string {
  const head = title.split(':')[0] ?? title;
  const parts: string[] = [];
  for (const part of head.split(SEPARATOR)) {
    const name = displayDrugName(part);
    if (name && !parts.some((seen) => sameDrugName(seen, name))) parts.push(name);
  }
  return parts.length > 0 ? parts.join(SEPARATOR) : displayDrugName(head);
}
