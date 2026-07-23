import type { MedicalDocumentSummary, SearchResultCategory } from '@localmed/contracts';
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
      class={props.class}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {props.name === 'lungs' && (
        <>
          <path d="M11 4v7c-1.6-2.6-3.2-4.2-4.7-4.2-2.3 0-3.3 5.1-3.3 8.2 0 2.8 1.5 4 3.7 4 2.5 0 4.3-2 4.3-5" />
          <path d="M13 4v7c1.6-2.6 3.2-4.2 4.7-4.2 2.3 0 3.3 5.1 3.3 8.2 0 2.8-1.5 4-3.7 4-2.5 0-4.3-2-4.3-5" />
          <path d="M9 3h6" />
        </>
      )}
      {props.name === 'airway' && (
        <>
          <path d="M10 3h4v8l4 4M10 11l-4 4M8.5 6h7M8.5 9h7" />
          <path d="M6 15v4M18 15v4M12 11v8" />
        </>
      )}
      {props.name === 'stomach' && (
        <path d="M10 3v7c0 1.5-1 2-2.3 2.4C5.4 13.1 4 14.8 4 17c0 2.7 2.2 4 5.2 4 5.6 0 9.8-3.4 9.8-8.2 0-2.4-1.2-4.1-3.2-4.8-1.2-.4-1.8-1.3-1.8-2.5V3" />
      )}
      {props.name === 'brain' && (
        <>
          <path d="M9.5 5.2A3.1 3.1 0 0 0 4.8 8a3.2 3.2 0 0 0 .2 6.2A3.2 3.2 0 0 0 9.2 19H11V6.2c-.3-.5-.8-.8-1.5-1Z" />
          <path d="M14.5 5.2A3.1 3.1 0 0 1 19.2 8a3.2 3.2 0 0 1-.2 6.2 3.2 3.2 0 0 1-4.2 4.8H13V6.2c.3-.5.8-.8 1.5-1Z" />
          <path d="M7 10h4M13 14h4M7 16h4M13 8h3" />
        </>
      )}
      {props.name === 'infection' && (
        <>
          <path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Z" />
          <circle cx="12" cy="11" r="2.3" />
          <path d="m12 7.5.5 1.3M15 9l-1.2.7M15.3 12.5l-1.4-.3M9 9l1.2.7M8.7 12.5l1.4-.3M12 14.5l-.5-1.3" />
        </>
      )}
      {props.name === 'pill' && (
        <>
          <path d="M8.2 4.5a4 4 0 0 1 5.6 0l5.7 5.7a4 4 0 0 1-5.7 5.6l-5.6-5.6a4 4 0 0 1 0-5.7Z" />
          <path d="m10.5 12.5 5.8-5.8" />
        </>
      )}
      {props.name === 'antibiotic' && (
        <>
          <rect x="3" y="8" width="14" height="8" rx="4" />
          <path d="M10 8v8" />
          <circle cx="19" cy="6" r="1.5" />
          <path d="M19 2.5v2M19 7.5v2M15.5 6h2M20.5 6h2" />
        </>
      )}
      {props.name === 'prescription' && (
        <>
          <path d="M5 3h9a3 3 0 0 1 0 6H8M8 3v17" />
          <path d="m12 12 7 8M19 12l-7 8" />
        </>
      )}
      {props.name === 'flask' && (
        <>
          <path d="M9 3h6M10 3v6l-5 8a2.5 2.5 0 0 0 2.1 4h9.8A2.5 2.5 0 0 0 19 17l-5-8V3" />
          <path d="M7.5 15h9" />
        </>
      )}
      {props.name === 'route' && (
        <>
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="6" r="2" />
          <path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3" />
          <path d="m14 12-2 2 2 2" />
        </>
      )}
      {props.name === 'calendar' && (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
        </>
      )}
      {props.name === 'kidney' && (
        <>
          <path d="M9 4C5 4 3 7.5 3 12c0 4 2 7 5 7 2 0 3-1.5 3-4V8c0-2.5-.8-4-2-4Z" />
          <path d="M15 4c4 0 6 3.5 6 8 0 4-2 7-5 7-2 0-3-1.5-3-4V8c0-2.5.8-4 2-4Z" />
        </>
      )}
      {props.name === 'heart' && (
        <path d="M20.8 5.7c-2.1-2.2-5.5-1.8-7.3.4L12 8l-1.5-1.9C8.7 3.9 5.3 3.5 3.2 5.7 1 8 1.4 11.4 3.6 13.5L12 21l8.4-7.5c2.2-2.1 2.6-5.5.4-7.8Z" />
      )}
      {props.name === 'overview' && (
        <>
          <path d="M6 3h9l3 3v15H6z" />
          <path d="M14 3v4h4M9 11h6M9 15h6" />
        </>
      )}
      {props.name === 'differential' && (
        <>
          <circle cx="9" cy="9" r="5" />
          <path d="m13 13 7 7M9 6v6M6 9h6" />
        </>
      )}
      {props.name === 'alert' && (
        <>
          <path d="M12 3 2.8 20h18.4L12 3Z" />
          <path d="M12 9v5M12 17h.01" />
        </>
      )}
    </svg>
  );
}
