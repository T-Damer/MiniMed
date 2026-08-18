import type { MedicalDocumentSummary, SearchResultCategory } from '@localmed/contracts';
import bowlFoodBold from '@phosphor-icons/core/assets/bold/bowl-food-bold.svg?raw';
import brainBold from '@phosphor-icons/core/assets/bold/brain-bold.svg?raw';
import calendarBold from '@phosphor-icons/core/assets/bold/calendar-bold.svg?raw';
import dropBold from '@phosphor-icons/core/assets/bold/drop-bold.svg?raw';
import fileTextBold from '@phosphor-icons/core/assets/bold/file-text-bold.svg?raw';
import flaskBold from '@phosphor-icons/core/assets/bold/flask-bold.svg?raw';
import folderOpenBold from '@phosphor-icons/core/assets/bold/folder-open-bold.svg?raw';
import heartBold from '@phosphor-icons/core/assets/bold/heart-bold.svg?raw';
import pathBold from '@phosphor-icons/core/assets/bold/path-bold.svg?raw';
import pillBold from '@phosphor-icons/core/assets/bold/pill-bold.svg?raw';
import plusMinusBold from '@phosphor-icons/core/assets/bold/plus-minus-bold.svg?raw';
import syringeBold from '@phosphor-icons/core/assets/bold/syringe-bold.svg?raw';
import virusBold from '@phosphor-icons/core/assets/bold/virus-bold.svg?raw';
import warningBold from '@phosphor-icons/core/assets/bold/warning-bold.svg?raw';
import windBold from '@phosphor-icons/core/assets/bold/wind-bold.svg?raw';
import type { JSX } from 'solid-js';

export type ClinicalGlyphName =
  | 'lungs'
  | 'airway'
  | 'stomach'
  | 'brain'
  | 'infection'
  | 'pill'
  | 'antibiotic'
  | 'prescription'
  | 'flask'
  | 'route'
  | 'calendar'
  | 'kidney'
  | 'heart'
  | 'overview'
  | 'differential'
  | 'alert';

export interface ClinicalSignal {
  readonly icon: ClinicalGlyphName;
  readonly label: string;
  readonly tone: 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'neutral';
  readonly strength: 'primary' | 'secondary';
}

export const CATEGORY_VISUALS: Readonly<
  Record<SearchResultCategory, { icon: ClinicalGlyphName; tone: ClinicalSignal['tone'] }>
> = {
  overview: { icon: 'overview', tone: 'neutral' },
  'clinical-picture': { icon: 'alert', tone: 'amber' },
  'differential-diagnosis': { icon: 'differential', tone: 'purple' },
  diagnostics: { icon: 'flask', tone: 'cyan' },
  treatment: { icon: 'pill', tone: 'green' },
  routing: { icon: 'route', tone: 'red' },
  'follow-up': { icon: 'calendar', tone: 'blue' },
  other: { icon: 'overview', tone: 'neutral' },
};

function svgBody(asset: string): string {
  return asset.slice(asset.indexOf('>') + 1, asset.lastIndexOf('</svg>'));
}

const glyphBodies: Record<ClinicalGlyphName, string> = {
  lungs: svgBody(windBold),
  airway: svgBody(windBold),
  stomach: svgBody(bowlFoodBold),
  brain: svgBody(brainBold),
  infection: svgBody(virusBold),
  pill: svgBody(pillBold),
  antibiotic: svgBody(syringeBold),
  prescription: svgBody(folderOpenBold),
  flask: svgBody(flaskBold),
  route: svgBody(pathBold),
  calendar: svgBody(calendarBold),
  kidney: svgBody(dropBold),
  heart: svgBody(heartBold),
  overview: svgBody(fileTextBold),
  differential: svgBody(plusMinusBold),
  alert: svgBody(warningBold),
};

function includesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export function documentClinicalSignals(
  document: MedicalDocumentSummary,
): readonly ClinicalSignal[] {
  const value =
    `${document.title} ${document.shortTitle ?? ''} ${document.specialties.join(' ')}`.toLowerCase();
  const signals: ClinicalSignal[] = [];
  const add = (signal: ClinicalSignal): void => {
    if (!signals.some((item) => item.icon === signal.icon)) signals.push(signal);
  };

  if (includesAny(value, ['пневмон', 'бронх', 'бронхиол', 'пульмон', 'дыхатель'])) {
    add({ icon: 'lungs', label: 'Нижние дыхательные пути', tone: 'blue', strength: 'primary' });
  }
  if (includesAny(value, ['ринит', 'синус', 'гортан', 'ларинг', 'трахе', 'верхн'])) {
    add({ icon: 'airway', label: 'Верхние дыхательные пути', tone: 'cyan', strength: 'primary' });
  }
  if (includesAny(value, ['ротавирус', 'кишеч', 'гастро', 'живот', 'питан'])) {
    add({ icon: 'stomach', label: 'ЖКТ и питание', tone: 'amber', strength: 'primary' });
  }
  if (includesAny(value, ['менинг', 'энцефал', 'неврол', 'судорог'])) {
    add({ icon: 'brain', label: 'Нервная система', tone: 'purple', strength: 'primary' });
  }
  if (includesAny(value, ['мочев', 'нефр', 'уролог', 'почек'])) {
    add({ icon: 'kidney', label: 'Почки и мочевая система', tone: 'cyan', strength: 'primary' });
  }
  if (includesAny(value, ['корь', 'инфекц', 'менингокок', 'вирус', 'бактери'])) {
    add({
      icon: 'infection',
      label: 'Инфекция и иммунитет',
      tone: 'red',
      strength: signals.length ? 'secondary' : 'primary',
    });
  }
  if (includesAny(value, ['лекарств', 'препарат', 'регистрац'])) {
    add({ icon: 'pill', label: 'Лекарственный препарат', tone: 'green', strength: 'primary' });
  }
  if (includesAny(value, ['антибиот', 'амокси', 'цефтри', 'азитро'])) {
    add({
      icon: 'antibiotic',
      label: 'Антибактериальный препарат',
      tone: 'green',
      strength: 'primary',
    });
  }
  if (includesAny(value, ['приказ', 'норматив', 'порядок'])) {
    add({
      icon: 'prescription',
      label: 'Нормативный документ',
      tone: 'neutral',
      strength: 'primary',
    });
  }

  return signals.length
    ? signals.slice(0, 4)
    : [{ icon: 'overview', label: 'Медицинский документ', tone: 'neutral', strength: 'primary' }];
}

export function ClinicalGlyph(props: {
  readonly name: ClinicalGlyphName;
  readonly class?: string;
}): JSX.Element {
  return (
    <svg
      class={`clinical-glyph${props.class ? ` ${props.class}` : ''}`}
      viewBox="0 0 256 256"
      aria-hidden="true"
      fill="currentColor"
      innerHTML={glyphBodies[props.name]}
    />
  );
}
