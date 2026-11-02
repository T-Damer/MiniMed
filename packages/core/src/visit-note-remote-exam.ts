import type { RemoteExamFinding } from '@localmed/contracts';

import { quoteWords } from './visit-note-quotes';

/**
 * Examination findings that need hands, a stethoscope or a hammer. In the note of a video or phone
 * visit they cannot have been obtained, so the draft lists them for the doctor to remove or to mark
 * as reported by the patient. Temperature, pressure and pulse are not here: patients measure them at
 * home and say them. Patterns run on quote words (lower case, «ё» as «е», single spaces).
 */
export interface RemoteExamFindingDefinition {
  readonly kind: string;
  readonly pattern: RegExp;
}

const W = '(?<![0-9a-zа-я])';
const finding = (kind: string, body: string): RemoteExamFindingDefinition => ({
  kind,
  pattern: new RegExp(`${W}(?:${body})`, 'gu'),
});

export const REMOTE_EXAM_FINDINGS: readonly RemoteExamFindingDefinition[] = [
  finding('palpation', 'пальп[а-я]*'),
  finding('percussion', 'перку[а-я]*'),
  finding(
    'auscultation',
    'аускульт[а-я]*|тоны сердца|дыхание (?:везикулярн|жестк|ослабл|бронхиальн|пуэрильн)[а-я]*|хрип(?:ы|ов|ами|ах)?(?![а-я])|(?:систолическ|диастолическ)[а-я]* шум|шум трения',
  ),
  finding('abdomen', 'живот (?:не )?(?:мягк|напряж|болезнен|безболезнен)[а-я]*'),
  finding('liver', 'печень (?:не )?(?:увелич|у края|выступа)[а-я]*|край печени'),
  finding('lymph-nodes', 'лимфоузл[а-я]* (?:не )?(?:увелич|безболезнен|подвижн|плотн|мягк)[а-я]*'),
  finding('meningeal-signs', 'менингеальн[а-я]*'),
  finding('reflexes', 'рефлекс[а-я]*|сухожильн[а-я]*'),
  finding('costovertebral-tap', 'пастернацк[а-я]*|поколачивани[а-я]*'),
  finding('pitting-edema', 'пастозн[а-я]*'),
];

/** Hands-on findings in `examination`, in text order; overlapping matches keep the first. */
export function findRemoteExamFindings(
  examination: string,
  definitions: readonly RemoteExamFindingDefinition[] = REMOTE_EXAM_FINDINGS,
): RemoteExamFinding[] {
  const words = quoteWords(examination);
  const matches: { kind: string; from: number; to: number }[] = [];
  for (const definition of definitions) {
    for (const match of words.text.matchAll(definition.pattern)) {
      matches.push({ kind: definition.kind, from: match.index, to: match.index + match[0].length });
    }
  }
  matches.sort((left, right) => left.from - right.from || right.to - left.to);
  const findings: RemoteExamFinding[] = [];
  let reached = 0;
  for (const match of matches) {
    if (match.from < reached) continue;
    reached = match.to;
    const start = (words.offsets[match.from] as { start: number }).start;
    const end = (words.offsets[match.to - 1] as { end: number }).end;
    findings.push({ kind: match.kind, start, end, text: examination.slice(start, end) });
  }
  return findings;
}
