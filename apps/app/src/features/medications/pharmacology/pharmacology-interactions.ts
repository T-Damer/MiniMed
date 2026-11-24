/**
 * Schema-first deterministic evaluator for drug–drug interactions from `DrugPharmacologyProfile`
 * JSON schemas (receptors, clinical effect intensities, CYP metabolism, half-life).
 *
 * Supplements — never replaces — official GRLS/ESKLP instruction interaction quotes
 * (AGENTS.md «Product invariant» & «Schema first»). Works completely offline even before full
 * instruction modules are downloaded.
 */
import type {
  ClinicalEffectKind,
  ClinicalEffectLevel,
  DrugPharmacologyProfile,
  DrugReceptorBinding,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';
import { lookupDrugPharmacology } from '@/features/medications/pharmacology/psychotropic-pharmacology';

export type PharmacologyInteractionSeverity = 'high' | 'moderate' | 'info';

export interface PharmacologyInteractionFinding {
  readonly id: string;
  readonly severity: PharmacologyInteractionSeverity;
  readonly title: string;
  readonly mechanism: string;
  readonly detail: string;
  readonly tags: readonly string[];
}

export interface DrugCypProfile {
  readonly substrates: readonly string[];
  readonly inhibitors: readonly string[];
  readonly inducers: readonly string[];
}

const CYP_NAMES = [
  'CYP1A2',
  'CYP2B6',
  'CYP2C8',
  'CYP2C9',
  'CYP2C19',
  'CYP2D6',
  'CYP3A4',
  'UGT',
] as const;

const SEVERITY_ORDER: Readonly<Record<PharmacologyInteractionSeverity, number>> = {
  high: 0,
  moderate: 1,
  info: 2,
};

export function lookupPharmacologyForCandidates(
  candidates: readonly (string | null | undefined)[],
): DrugPharmacologyProfile | null {
  for (const candidate of candidates) {
    const found = lookupDrugPharmacology(candidate);
    if (found) return found;
  }
  return null;
}

function effectLevel(
  profile: DrugPharmacologyProfile,
  kind: ClinicalEffectKind,
): ClinicalEffectLevel {
  return profile.effects.find((item) => item.kind === kind)?.level ?? 0;
}

function hasStrongReceptor(
  profile: DrugPharmacologyProfile,
  pattern: RegExp,
  tiers: readonly DrugReceptorBinding['affinity'][] = ['very-high', 'high'],
): DrugReceptorBinding | null {
  return (
    profile.receptors.find(
      (binding) => pattern.test(binding.receptor) && tiers.includes(binding.affinity),
    ) ?? null
  );
}

/**
 * Extracts CYP enzyme roles (substrate, inhibitor, inducer) deterministically from the profile's
 * structured `pk.metabolism` string.
 */
export function extractCypProfile(metabolism: string | undefined): DrugCypProfile {
  if (!metabolism) return { substrates: [], inhibitors: [], inducers: [] };
  const substrates = new Set<string>();
  const inhibitors = new Set<string>();
  const inducers = new Set<string>();

  const clauses = metabolism.split(/[;,.()]+/u).map((part) => part.trim());
  for (const clause of clauses) {
    if (!clause) continue;
    const lower = clause.toLocaleLowerCase('ru-RU');
    const isInhibitor = /ингибитор|угнета/u.test(lower);
    const isInducer = /индуктор|индуциру|аутоиндукц/u.test(lower);
    for (const cyp of CYP_NAMES) {
      if (!new RegExp(`\\b${cyp}`, 'iu').test(clause)) continue;
      if (isInhibitor) {
        inhibitors.add(cyp);
      } else if (isInducer) {
        inducers.add(cyp);
      } else {
        substrates.add(cyp);
      }
    }
  }

  return {
    substrates: [...substrates],
    inhibitors: [...inhibitors],
    inducers: [...inducers],
  };
}

function hasLongHalfLifeDays(halfLife: string): boolean {
  return /(?:\d+\s*(?:сут|дн|нед)|(?:4[0-9]|[5-9]\d|\d{3,})\s*ч)/iu.test(halfLife);
}

/**
 * Evaluates pharmacodynamic & pharmacokinetic interaction signals between two drug schemas.
 * Returns findings ordered by clinical priority (`high` → `moderate` → `info`).
 */
export function evaluatePharmacologyPair(
  a: DrugPharmacologyProfile,
  b: DrugPharmacologyProfile,
  nameA: string,
  nameB: string,
): readonly PharmacologyInteractionFinding[] {
  const findings: PharmacologyInteractionFinding[] = [];

  // 1. Serotonergic synergy (SERT + SERT or SERT + strong 5-HT modulator)
  const sertA = hasStrongReceptor(a, /^SERT\b/iu, ['very-high', 'high', 'moderate']);
  const sertB = hasStrongReceptor(b, /^SERT\b/iu, ['very-high', 'high', 'moderate']);
  const ht1aA = hasStrongReceptor(a, /^5-?HT1A\b/iu, ['very-high', 'high']);
  const ht1aB = hasStrongReceptor(b, /^5-?HT1A\b/iu, ['very-high', 'high']);
  if (sertA && sertB) {
    findings.push({
      id: 'pd-serotonin',
      severity: 'high',
      title: 'Риск серотонинового синдрома',
      mechanism: 'Двойная блокада обратного захвата серотонина (SERT + SERT)',
      detail: `Оба препарата (${nameA} и ${nameB}) ингибируют SERT; совместный приём или смена без вымывания повышает риск серотониновой токсичности (тремор, гиперрефлексия, гипертермия, ажитация).`,
      tags: ['SERT', '5-HT'],
    });
  } else if ((sertA && ht1aB) || (sertB && ht1aA)) {
    findings.push({
      id: 'pd-serotonin-mod',
      severity: 'moderate',
      title: 'Аддитивный серотонинергический эффект',
      mechanism: 'Ингибитор SERT + модулятор 5-HT₁A',
      detail: `Комбинация усиливает центральную серотониновую передачу; отслеживайте ранние признаки серотониновой гиперактивации при титрации.`,
      tags: ['SERT', '5-HT1A'],
    });
  }

  // 2. QTc prolongation summation
  const qtcA = effectLevel(a, 'qtc');
  const qtcB = effectLevel(b, 'qtc');
  if (qtcA >= 2 && qtcB >= 2) {
    findings.push({
      id: 'pd-qtc-high',
      severity: 'high',
      title: 'Суммация риска удлинения интервала QTc',
      mechanism: `Оба препарата значимо влияют на QTc (${nameA}: ${'+'.repeat(qtcA)}, ${nameB}: ${'+'.repeat(qtcB)})`,
      detail:
        'Сочетание двух препаратов с умеренным/выраженным риском удлинения QTc повышает вероятность желудочковой аритмии (torsades de pointes); показан контроль ЭКГ (QTc) и электролитов (K⁺, Mg²⁺).',
      tags: ['QTc', 'ЭКГ'],
    });
  } else if ((qtcA >= 2 && qtcB >= 1) || (qtcB >= 2 && qtcA >= 1)) {
    findings.push({
      id: 'pd-qtc-mod',
      severity: 'moderate',
      title: 'Возможная суммация влияния на QTc',
      mechanism: `Вклад в удлинение QTc у обоих препаратов (${'+'.repeat(qtcA)} и ${'+'.repeat(qtcB)})`,
      detail:
        'При наличии факторов риска (брадикардия, гипокалиемия, органическая патология сердца) рекомендуется контроль ЭКГ до и после подбора доз.',
      tags: ['QTc'],
    });
  }

  // 3. Additive CNS sedation (H1 / GABA-A / sedation >= 2)
  const sedA = effectLevel(a, 'sedation');
  const sedB = effectLevel(b, 'sedation');
  const h1A = hasStrongReceptor(a, /^H1\b/iu);
  const h1B = hasStrongReceptor(b, /^H1\b/iu);
  const gabaA = hasStrongReceptor(a, /^(?:GABA|ГАМК)/iu, ['very-high', 'high', 'moderate']);
  const gabaB = hasStrongReceptor(b, /^(?:GABA|ГАМК)/iu, ['very-high', 'high', 'moderate']);
  if (
    (gabaA && sedB >= 2) ||
    (gabaB && sedA >= 2) ||
    (sedA >= 3 && sedB >= 2) ||
    (sedB >= 3 && sedA >= 2)
  ) {
    findings.push({
      id: 'pd-sedation-high',
      severity: 'high',
      title: 'Выраженная суммация седации и угнетения ЦНС',
      mechanism: [
        gabaA || gabaB ? 'ГАМК-А' : null,
        h1A || h1B ? 'H₁-блокада' : null,
        `Седация ${'+'.repeat(sedA)} + ${'+'.repeat(sedB)}`,
      ]
        .filter(Boolean)
        .join(' · '),
      detail:
        'Повышен риск чрезмерной сонливости, падений, снижения реакции и угнетения дыхания (особенно при участии бензодиазепинов или у пожилых).',
      tags: [...(gabaA || gabaB ? ['GABA-A'] : []), ...(h1A || h1B ? ['H1'] : []), 'Седация'],
    });
  } else if (sedA >= 2 && sedB >= 2) {
    findings.push({
      id: 'pd-sedation-mod',
      severity: 'moderate',
      title: 'Суммация седативного действия',
      mechanism: `${h1A && h1B ? 'Общая H₁-блокада · ' : ''}Седация ${'+'.repeat(sedA)} + ${'+'.repeat(sedB)}`,
      detail:
        'Совместный приём усиливает дневную сонливость и заторможенность; оценивайте переносимость и время приёма.',
      tags: [...(h1A && h1B ? ['H1'] : []), 'Седация'],
    });
  }

  // 4. Anticholinergic burden (M1)
  const achA = effectLevel(a, 'anticholinergic');
  const achB = effectLevel(b, 'anticholinergic');
  const m1A = hasStrongReceptor(a, /^M[1-5]/iu);
  const m1B = hasStrongReceptor(b, /^M[1-5]/iu);
  if ((achA >= 2 && achB >= 2) || (m1A && m1B)) {
    findings.push({
      id: 'pd-anticholinergic',
      severity: achA >= 3 || achB >= 3 ? 'high' : 'moderate',
      title: 'Суммация антихолинергической нагрузки',
      mechanism: `Общая М-холиноблокада (M₁: ${nameA} + ${nameB})`,
      detail:
        'Возрастает риск сухости во рту, запора (вплоть до паралитической непроходимости), задержки мочи, тахикардии и когнитивного снижения / делирия (особенно у пациентов старше 60 лет).',
      tags: ['M1', 'М-холиноблок'],
    });
  }

  // 5. Orthostatic hypotension (α1)
  const orthoA = effectLevel(a, 'orthostasis');
  const orthoB = effectLevel(b, 'orthostasis');
  const a1A = hasStrongReceptor(a, /^[ΑAαa]1/iu);
  const a1B = hasStrongReceptor(b, /^[ΑAαa]1/iu);
  if ((orthoA >= 2 && orthoB >= 2) || (a1A && a1B)) {
    findings.push({
      id: 'pd-orthostasis',
      severity: 'moderate',
      title: 'Аддитивный риск ортостатической гипотензии',
      mechanism: 'Двойная блокада α₁-адренорецепторов',
      detail:
        'Повышается вероятность падения АД при вставании, головокружения, синкопе и падений; требуется осторожная титрация.',
      tags: ['α1', 'Ортостаз'],
    });
  }

  // 6. Dual D2 antagonism (EPS / prolactin)
  const d2A = hasStrongReceptor(a, /^D2/iu);
  const d2B = hasStrongReceptor(b, /^D2/iu);
  const epsA = effectLevel(a, 'eps');
  const epsB = effectLevel(b, 'eps');
  const d2AntagonistA = d2A && !/частичн/iu.test(d2A.action);
  const d2AntagonistB = d2B && !/частичн/iu.test(d2B.action);
  if ((d2AntagonistA && d2AntagonistB) || (epsA >= 2 && epsB >= 2)) {
    findings.push({
      id: 'pd-dopamine-d2',
      severity: 'moderate',
      title: 'Двойная дофаминовая блокада (D₂) — риск ЭПС и пролактина',
      mechanism: 'Перекрывающийся антагонизм D₂ в нигростриарном и тубероинфундибулярном путях',
      detail:
        'Антипсихотическая полипрагмазия повышает риск экстрапирамидных нарушений, акатизии и гиперпролактинемии без доказанного преимущества при рутинном применении.',
      tags: ['D2', 'ЭПС'],
    });
  }

  // 7. Pharmacokinetic CYP interactions
  const cypA = extractCypProfile(a.pk.metabolism);
  const cypB = extractCypProfile(b.pk.metabolism);

  for (const cyp of cypA.inhibitors) {
    if (cypB.substrates.includes(cyp)) {
      findings.push({
        id: `pk-inh-ab-${cyp}`,
        severity: 'high',
        title: `Ингибирование ${cyp}: рост концентрации ${nameB}`,
        mechanism: `${nameA} ингибирует ${cyp} · ${nameB} метаболизируется через ${cyp}`,
        detail: `${nameA} замедляет метаболизм ${nameB} через ${cyp}, что может существенно повысить концентрацию ${nameB} в плазме и усилить его побочные эффекты.`,
        tags: [cyp, 'Ингибитор'],
      });
    }
  }
  for (const cyp of cypB.inhibitors) {
    if (cypA.substrates.includes(cyp)) {
      findings.push({
        id: `pk-inh-ba-${cyp}`,
        severity: 'high',
        title: `Ингибирование ${cyp}: рост концентрации ${nameA}`,
        mechanism: `${nameB} ингибирует ${cyp} · ${nameA} метаболизируется через ${cyp}`,
        detail: `${nameB} замедляет метаболизм ${nameA} через ${cyp}, повышая риск дозозависимых нежелательных реакций ${nameA}.`,
        tags: [cyp, 'Ингибитор'],
      });
    }
  }
  for (const cyp of cypA.inducers) {
    if (cypB.substrates.includes(cyp)) {
      findings.push({
        id: `pk-ind-ab-${cyp}`,
        severity: 'moderate',
        title: `Индукция ${cyp}: снижение концентрации ${nameB}`,
        mechanism: `${nameA} индуцирует ${cyp} · ${nameB} метаболизируется через ${cyp}`,
        detail: `${nameA} ускоряет выведение ${nameB} через ${cyp}, что может ослабить клинический эффект ${nameB} (потребуется контроль эффективности или дозы).`,
        tags: [cyp, 'Индуктор'],
      });
    }
  }
  for (const cyp of cypB.inducers) {
    if (cypA.substrates.includes(cyp)) {
      findings.push({
        id: `pk-ind-ba-${cyp}`,
        severity: 'moderate',
        title: `Индукция ${cyp}: снижение концентрации ${nameA}`,
        mechanism: `${nameB} индуцирует ${cyp} · ${nameA} метаболизируется через ${cyp}`,
        detail: `${nameB} ускоряет выведение ${nameA} через ${cyp}, потенциально снижая его эффективность.`,
        tags: [cyp, 'Индуктор'],
      });
    }
  }

  const sharedSubstrates = cypA.substrates.filter(
    (cyp) =>
      cypB.substrates.includes(cyp) &&
      !cypA.inhibitors.includes(cyp) &&
      !cypB.inhibitors.includes(cyp) &&
      !cypA.inducers.includes(cyp) &&
      !cypB.inducers.includes(cyp),
  );
  if (sharedSubstrates.length > 0) {
    findings.push({
      id: `pk-shared-${sharedSubstrates.join('-')}`,
      severity: 'info',
      title: `Общий путь метаболизма: ${sharedSubstrates.join(', ')}`,
      mechanism: 'Оба препарата являются субстратами одного изофермента',
      detail: `При высоких дозах или у медленных метаболизаторов возможна конкуренция за ${sharedSubstrates.join(', ')}.`,
      tags: sharedSubstrates,
    });
  }

  // 8. Long t1/2 washout reminder
  const longA = hasLongHalfLifeDays(a.pk.halfLife);
  const longB = hasLongHalfLifeDays(b.pk.halfLife);
  if (longA || longB) {
    const names = [
      longA ? `${nameA} (${a.pk.halfLife})` : null,
      longB ? `${nameB} (${b.pk.halfLife})` : null,
    ]
      .filter(Boolean)
      .join('; ');
    findings.push({
      id: 'pk-long-halflife',
      severity: 'info',
      title: 'Длительный период полувыведения (t½) при смене терапии',
      mechanism: names,
      detail:
        'Препарат с длительным t½ (или его активные метаболиты) сохраняет фармакологическое и CYP-взаимодействие ещё дни–недели после отмены.',
      tags: ['t½', 'Вымывание'],
    });
  }

  findings.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
  return findings;
}
