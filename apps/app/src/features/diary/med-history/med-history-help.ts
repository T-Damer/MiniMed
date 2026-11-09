/**
 * The «?» of each field of a medicine taken before (MEDHIST1), declared as data: one text for the
 * patient (how to fill it, plain words) and one for the doctor (the definition and its source).
 * Clinical statements here only repeat a named source; where sources disagree the text says
 * «данные противоречивы» and names both. No text judges a medicine.
 */
import type { HelpSource } from '@/components/HelpSources';

export type MedHistoryViewer = 'patient' | 'doctor';

export type MedHistoryHelpKey =
  | 'name'
  | 'when'
  | 'stop'
  | 'reaction'
  | 'severity'
  | 'allergy'
  | 'effect'
  | 'warning';

export interface MedHistoryHelp {
  readonly patient: string;
  readonly doctor: string;
  /** Sources of the doctor's text (the patient's is about filling in only). */
  readonly sources?: readonly HelpSource[];
}

export const MED_HISTORY_SOURCES = {
  who1972: {
    title:
      'International drug monitoring: the role of national centres. Technical Report Series No. 498',
    publisher: 'ВОЗ',
    year: '1972',
  },
  wao2004: {
    title: 'Revised nomenclature for allergy for global use (Johansson S.G.O. et al.)',
    publisher: 'World Allergy Organization · J Allergy Clin Immunol 113(5):832–836',
    year: '2004',
    url: 'https://doi.org/10.1016/j.jaci.2003.12.591',
  },
  fhir: {
    title: 'AllergyIntoleranceType (allergy, intolerance)',
    publisher: 'HL7 FHIR',
    year: 'текущая сборка',
    url: 'https://build.fhir.org/codesystem-allergy-intolerance-type.html',
  },
  ctcae: {
    title: 'Common Terminology Criteria for Adverse Events (CTCAE) v5.0',
    publisher: 'National Cancer Institute',
    year: '2017',
    url: 'https://ctep.cancer.gov/protocoldevelopment/electronic_applications/ctc.htm',
  },
  atc: {
    title: 'ATC: structure and principles',
    publisher: 'WHO Collaborating Centre for Drug Statistics Methodology',
    url: 'https://atcddd.fhi.no/atc/structure_and_principles/',
  },
} as const satisfies Readonly<Record<string, HelpSource>>;

export const MED_HISTORY_HELP: Readonly<Record<MedHistoryHelpKey, MedHistoryHelp>> = {
  name: {
    patient:
      'Начните вводить название и выберите из списка — или оставьте как написали. Подойдёт и название с упаковки.',
    doctor:
      'Выбор из справочника ЕСКЛП сохраняет МНН и коды АТХ, по ним работает предупреждение при назначении. Свой текст сравнивается только по названию.',
  },
  when: {
    patient:
      'Год (2022), месяц и год (03.2022) или точная дата. Не помните точно — отметьте «Примерно» или напишите, сколько принимали: «около года».',
    doctor:
      'Точность — год, месяц или день; «Примерно» помечает даты как приблизительные. Длительность словами — когда дат нет.',
  },
  stop: {
    patient: 'Выберите, почему лекарство перестали принимать. Если была реакция, опишите её ниже.',
    doctor:
      'Нежелательная реакция (ВОЗ, 1972) — вредная и непреднамеренная реакция на препарат в дозах, обычно применяемых у человека. Об аллергии и непереносимости данные противоречивы: WAO (2004) называет аллергией реакцию гиперчувствительности, начатую иммунными механизмами; HL7 FHIR относит к allergy и аллергоподобные реакции, включая псевдоаллергию, а intolerance — реакцию, не признанную аллергической или аллергоподобной, обычно (но не обязательно) неиммунную.',
    sources: [MED_HISTORY_SOURCES.who1972, MED_HISTORY_SOURCES.wao2004, MED_HISTORY_SOURCES.fhir],
  },
  reaction: {
    patient: 'Что произошло и когда: «сыпь на второй день», «дрожь в руках».',
    doctor: 'Со слов пациента или по документам; текст не проверяется.',
  },
  severity: {
    patient:
      'Лёгкая — было заметно, но не мешало. Средняя — мешала обычным делам. Тяжёлая — не могли себя обслуживать или попали в больницу. Угрожала жизни — нужна была срочная помощь.',
    doctor:
      'Ступени по степеням CTCAE v5.0: 1 — лёгкая, вмешательство не показано; 2 — умеренная, показано минимальное или местное вмешательство, ограничивает инструментальную повседневную активность; 3 — тяжёлая или значимая, но не угрожающая жизни немедленно, госпитализация, ограничивает самообслуживание; 4 — угрожающие жизни последствия, показано срочное вмешательство.',
    sources: [MED_HISTORY_SOURCES.ctcae],
  },
  allergy: {
    patient: 'Отметьте «Да», если врач говорил, что это аллергия. Не уверены — «Не знаю».',
    doctor:
      'WAO (2004): аллергия — реакция гиперчувствительности, начатая иммунными механизмами. «Да» включает предупреждение при назначении того же препарата и препаратов его группы АТХ.',
    sources: [MED_HISTORY_SOURCES.wao2004],
  },
  effect: {
    patient: 'Как вы сами оцениваете: помогло ли лекарство.',
    doctor: 'Оценка самого пациента.',
  },
  warning: {
    patient: '',
    doctor:
      'Сравниваются коды АТХ: то же вещество (5-й уровень) или та же подгруппа 4-го уровня — по ВОЗ это химическая, фармакологическая или терапевтическая подгруппа. Совпадение кода — не оценка риска перекрёстной реакции. Свой текст без кодов сравнивается по названию.',
    sources: [MED_HISTORY_SOURCES.atc],
  },
};
