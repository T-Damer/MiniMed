import type { FormFillSpeaker, FormFillSpeakerRole } from '@localmed/contracts';

/**
 * Who said a transcript line (FORMFILL1). The recorder stores plain lines; a line may start with a
 * speaker label — typed by the doctor, set from diarization («Спикер 1»), or in a dictated
 * transcript («Врач:», «Мама:»), optionally after a time stamp. Without a label the speaker is
 * unknown: the filler never guesses it from the wording.
 */

const LABEL = /^\s*(?:\[[^\]]*\]\s*)?([\p{L}][\p{L}\d ]{0,23}?)\s*:/u;

const ROLES: readonly (readonly [RegExp, FormFillSpeakerRole])[] = [
  [/^(?:врач|доктор|фельдшер|медсестра|медбрат|терапевт|педиатр|психиатр)/u, 'clinician'],
  [/^(?:пациент|пациентка|больной|больная)/u, 'patient'],
  [
    /^(?:мама|папа|мать|отец|жена|муж|сын|дочь|бабушка|дедушка|сестра|брат|родственни|сопровождающ|опекун)/u,
    'companion',
  ],
];

export function speakerOfLine(line: string): FormFillSpeaker {
  const label = LABEL.exec(line)?.[1]?.trim();
  if (!label) return { label: null, role: 'unknown' };
  const folded = label.toLowerCase().replaceAll('ё', 'е');
  const role = ROLES.find(([pattern]) => pattern.test(folded))?.[1] ?? 'unknown';
  return { label, role };
}
