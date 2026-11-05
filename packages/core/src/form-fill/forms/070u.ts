import type { FormFillOverlay } from '../adapters';

/**
 * 070/у «Справка для получения путевки на санаторно-курортное лечение» (274н,
 * `ru.minzdrav.274n.070u`) from a conversation: the diagnoses, the absence of contraindications and
 * the recommended treatment. Codes (ICD, region, climate, social support) and the patient's
 * documents come from the card and the doctor, not from the conversation.
 */
export const FORM_070U_OVERLAY: FormFillOverlay = {
  only: [
    'diagnosis',
    'comorbidities',
    'disabilityCause',
    'noContraindications',
    'treatmentSetting',
    'preferredPlace',
    'seasons',
    'escort',
  ],
  fields: {
    diagnosis: {
      label: 'Диагноз, с которым направляют на санаторно-курортное лечение',
      hint: 'основное заболевание словами врача',
      cues: ['основной диагноз', 'диагноз', 'основное заболевание'],
    },
    comorbidities: {
      hint: 'другие болезни пациента словами врача',
      cues: ['сопутствующ~ (?:заболевани~|диагноз~)', 'сопутствующ~'],
    },
    disabilityCause: {
      label: 'Заболевание — причина инвалидности',
      hint: 'только если названа инвалидность и её причина',
      cues: ['инвалидност~ (?:по поводу|из-за|по)'],
    },
    noContraindications: {
      hint: 'true, если врач сказал, что противопоказаний нет',
      cues: ['противопоказани~ (?:нет|отсутству~)', '(?:нет|без) противопоказани~'],
    },
    treatmentSetting: {
      hint: 'с проживанием в санатории или амбулаторно (курсовка)',
      options: {
        '1': ['в санатори~ с проживанием', 'с проживанием', 'стационарн~ в санатори~'],
        '2': ['амбулаторн~', 'курсовк~', 'без проживания'],
      },
    },
    preferredPlace: {
      hint: 'курорт или санаторий, который назвал пациент',
      cues: [
        '(?:хотел~|хочет|хочу|предпочита~|предпочтительн~)(?: бы)? (?:поехать |съездить )?(?:в|на)',
      ],
    },
    seasons: {
      hint: 'сезоны, которые врач рекомендовал',
      options: {
        '1': ['зим~'],
        '2': ['весн~', 'весной'],
        '3': ['лет(?:о|ом|ний|нее|нем)'],
        '4': ['осен~', 'осенью'],
      },
    },
    escort: {
      hint: 'нужен ли сопровождающий',
      cues: ['сопровожд~', 'сопровождающ~'],
    },
  },
};
