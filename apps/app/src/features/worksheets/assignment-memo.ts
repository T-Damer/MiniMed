/**
 * «Как давать задание» (CBT1, owner 2026-11-08), declared once for every worksheet: the doctor's
 * checklist when assigning and the patient's memo printed and shown with the sheet. Checked against
 * Дж. Бек «Когнитивная терапия. Полное руководство» (2006), ch. 14 (owner 2026-11-09: every claim
 * rests on a source).
 */

export interface AssignmentCheck {
  readonly id: string;
  readonly text: string;
}

/** The doctor's checklist when giving homework. */
export const ASSIGNMENT_CHECKLIST: readonly AssignmentCheck[] = [
  {
    id: 'together',
    text: 'Задание определено вместе с пациентом; он согласен его выполнить (Дж. Бек, 2006, с. 321).',
  },
  {
    id: 'why',
    text: 'Пациенту объяснено, каким образом и почему задание принесёт ему пользу (Дж. Бек, 2006, с. 321).',
  },
  {
    id: 'concrete',
    text: 'Задание определено чётко: что делать и когда; пациент записал его содержание (Дж. Бек, 2006, с. 325, 333, 336).',
  },
  {
    id: 'obstacles',
    text: 'Обсудили, что может помешать выполнению, и как с этим быть (Дж. Бек, 2006, с. 325–326).',
  },
  {
    id: 'review',
    text: 'Выполнение разберём на следующем приёме (Дж. Бек, 2006, с. 77, 339).',
  },
  {
    id: 'not-failure',
    text: 'Если задание не выполнено, выясняем, что помешало: практические или психологические причины; пациент не должен ощущать себя неудачником (Дж. Бек, 2006, с. 324, 329, 331).',
  },
];

/** The patient's memo: motivation and concrete steps; the last line never changes. */
export const PATIENT_MEMO = {
  whyTitle: 'Зачем это вам',
  whatTitle: 'Что и когда делать',
  notDone:
    'Если не получилось, ничего страшного. Расскажите на приёме, что помешало: при необходимости задание можно изменить.',
} as const;
