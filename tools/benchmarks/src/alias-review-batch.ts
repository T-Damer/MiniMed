import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AliasRecord } from '@localmed/domain';
import { analyzeClinicalQuery } from '@localmed/search-lexical';
import { parse as parseYaml } from 'yaml';

interface AliasCandidate {
  readonly id: string;
  readonly category: string;
  readonly canonicalTerm: string;
  readonly alias: string;
  readonly sourceDoc: string;
  readonly sourceQuote: string;
  readonly sampleQuery: string;
}

interface FactSnapshot {
  readonly kind: string;
  readonly label: string;
  readonly value: string;
  readonly normalizedValue: string;
}

interface RunSnapshot {
  readonly facts: readonly FactSnapshot[];
  readonly aliasMatches: readonly string[];
  readonly terms: readonly string[];
  readonly clinicalBranchTerms: readonly string[];
}

interface ReviewItem {
  readonly candidate: AliasCandidate;
  readonly before: RunSnapshot;
  readonly after: RunSnapshot;
  verdict: 'pending' | 'ok' | 'reject';
  note: string;
}

// Grounded in content/pilot-rf/{pneumonia,meningococcal,rotavirus,uti}.md — every canonicalTerm
// below reuses wording that already appears in those documents, and every alias is a colloquial
// phrasing a parent or non-specialist doctor might type instead. This is a draft for clinical
// review, not a claim of clinical accuracy.
const CANDIDATES: readonly AliasCandidate[] = [
  {
    id: 'alias.pilot.nasal-flaring',
    category: 'finding',
    canonicalTerm: 'раздувание крыльев носа дыхательная недостаточность пневмония',
    alias: 'раздувает ноздри при дыхании',
    sourceDoc: 'pneumonia.md',
    sourceQuote:
      'лихорадкой, кашлем, тахипноэ, одышкой, втяжением грудной клетки, стонущим дыханием, раздуванием крыльев носа',
    sampleQuery: 'Ребенок 8 месяцев, раздувает ноздри при дыхании, температура 38.5',
  },
  {
    id: 'alias.pilot.chest-pain-pneumonia',
    category: 'symptom',
    canonicalTerm: 'боль в груди пневмония',
    alias: 'болит в грудной клетке при кашле',
    sourceDoc: 'pneumonia.md',
    sourceQuote: 'локальными изменениями дыхания и болью в груди или животе',
    sampleQuery: 'Кашель неделю, болит в грудной клетке при кашле, температура держится',
  },
  {
    id: 'alias.pilot.apnea-infant',
    category: 'finding',
    canonicalTerm: 'апноэ дыхательная недостаточность',
    alias: 'перестает дышать на несколько секунд',
    sourceDoc: 'pneumonia.md',
    sourceQuote: 'Госпитализация требуется при ... апноэ или цианозе',
    sampleQuery: 'Грудничок иногда перестает дышать на несколько секунд, кашель',
  },
  {
    id: 'alias.pilot.cyanosis',
    category: 'finding',
    canonicalTerm: 'цианоз дыхательная недостаточность гипоксемия',
    alias: 'губы синеют',
    sourceDoc: 'pneumonia.md',
    sourceQuote: 'апноэ или цианозе, сатурации ниже 90% на воздухе',
    sampleQuery: 'Ребенок кашляет, губы синеют при плаче',
  },
  {
    id: 'alias.pilot.bulging-fontanelle',
    category: 'symptom',
    canonicalTerm: 'выбухание родничка менингококковая инфекция',
    alias: 'родничок выбухает',
    sourceDoc: 'meningococcal.md',
    sourceQuote: 'вялость, отказ от еды, монотонный крик, выбухание родничка',
    sampleQuery: 'Грудничок вялый, родничок выбухает, температура 39',
  },
  {
    id: 'alias.pilot.monotone-cry',
    category: 'symptom',
    canonicalTerm: 'монотонный крик менингококковая инфекция',
    alias: 'плачет на одной ноте',
    sourceDoc: 'meningococcal.md',
    sourceQuote: 'вялость, отказ от еды, монотонный крик',
    sampleQuery: 'Младенец плачет на одной ноте уже час, не берет грудь',
  },
  {
    id: 'alias.pilot.severe-headache-meningeal',
    category: 'symptom',
    canonicalTerm: 'сильная головная боль менингококковая инфекция',
    alias: 'сильно болит голова и тошнит',
    sourceDoc: 'meningococcal.md',
    sourceQuote: 'сильную головную боль, повторную рвоту, нарушение сознания',
    sampleQuery: 'Ребенок 10 лет, сильно болит голова и тошнит, температура 39.5',
  },
  {
    id: 'alias.pilot.abdominal-rumbling',
    category: 'symptom',
    canonicalTerm: 'урчание в животе ротавирусный гастроэнтерит',
    alias: 'живот урчит',
    sourceDoc: 'rotavirus.md',
    sourceQuote: 'рвотой, водянистой диареей, лихорадкой, болью или урчанием в животе',
    sampleQuery: 'Живот урчит второй день, понос и температура',
  },
  {
    id: 'alias.pilot.poor-appetite',
    category: 'symptom',
    canonicalTerm: 'снижение аппетита обезвоживание',
    alias: 'плохо ест второй день',
    sourceDoc: 'rotavirus.md',
    sourceQuote: 'болью или урчанием в животе и снижением аппетита',
    sampleQuery: 'Ребенок плохо ест второй день, рвота, вялый',
  },
  {
    id: 'alias.pilot.cloudy-urine',
    category: 'symptom',
    canonicalTerm: 'мутная моча резко пахнущая моча инфекция мочевых путей',
    alias: 'моча стала мутная и воняет',
    sourceDoc: 'uti.md',
    sourceQuote: 'мутная либо резко пахнущая моча',
    sampleQuery: 'У дочки моча стала мутная и воняет, больно писать',
  },
  {
    id: 'alias.pilot.urgency',
    category: 'symptom',
    canonicalTerm: 'императивные позывы инфекция мочевых путей',
    alias: 'резко хочет в туалет и не успевает добежать',
    sourceDoc: 'uti.md',
    sourceQuote: 'императивные позывы, боль над лоном или в животе',
    sampleQuery: 'Ребенок 6 лет резко хочет в туалет и не успевает добежать, температура',
  },
  {
    id: 'alias.pilot.daytime-wetting',
    category: 'symptom',
    canonicalTerm: 'дневное недержание энурез инфекция мочевых путей',
    alias: 'писается днем хотя раньше не было',
    sourceDoc: 'uti.md',
    sourceQuote: 'новое дневное недержание или энурез',
    sampleQuery: 'Девочка 5 лет писается днем хотя раньше не было такого',
  },
  {
    id: 'alias.pilot.chills',
    category: 'symptom',
    canonicalTerm: 'озноб пиелонефрит',
    alias: 'трясет от температуры',
    sourceDoc: 'uti.md',
    sourceQuote: 'лихорадкой без катаральных симптомов, ознобом, недомоганием',
    sampleQuery: 'Взрослого трясет от температуры, боль в пояснице',
  },
  {
    id: 'alias.pilot.disturbed-consciousness',
    category: 'symptom',
    canonicalTerm: 'нарушение сознания менингококковая инфекция',
    alias: 'стал заторможенным и плохо реагирует',
    sourceDoc: 'meningococcal.md',
    sourceQuote: 'нарушение сознания, судороги или менингеальные симптомы',
    sampleQuery: 'Ребенок стал заторможенным и плохо реагирует, сыпь на ногах',
  },
];

function factSnapshot(facts: readonly { kind: string; label: string; value: string; normalizedValue: string }[]): readonly FactSnapshot[] {
  return facts.map((fact) => ({
    kind: fact.kind,
    label: fact.label,
    value: fact.value,
    normalizedValue: fact.normalizedValue,
  }));
}

function runSnapshot(query: string, aliases: readonly AliasRecord[]): RunSnapshot {
  const plan = analyzeClinicalQuery(query, aliases);
  const clinical = plan.branches.find((branch) => branch.id === 'clinical');
  return {
    facts: factSnapshot(plan.analysis.facts),
    aliasMatches: plan.aliasMatches,
    terms: plan.terms,
    clinicalBranchTerms: clinical?.terms ?? [],
  };
}

const root = resolve(import.meta.dirname, '../../..');
const aliasesYamlPath = resolve(root, 'content/pilot-rf/aliases.yaml');
const parsedYaml = parseYaml(readFileSync(aliasesYamlPath, 'utf8')) as {
  aliases: readonly AliasRecord[];
};
const existingAliases = parsedYaml.aliases;

const items: ReviewItem[] = CANDIDATES.map((candidate) => {
  const candidateRecord: AliasRecord = {
    id: candidate.id,
    canonicalTerm: candidate.canonicalTerm,
    alias: candidate.alias,
    category: candidate.category,
    weight: 1,
  };
  return {
    candidate,
    before: runSnapshot(candidate.sampleQuery, existingAliases),
    after: runSnapshot(candidate.sampleQuery, [...existingAliases, candidateRecord]),
    verdict: 'pending',
    note: '',
  };
});

const outputDir = resolve(root, 'data/build');
mkdirSync(outputDir, { recursive: true });
const jsonPath = resolve(outputDir, 'alias-review-batch.json');
writeFileSync(jsonPath, JSON.stringify(items, null, 2));

console.log(`Wrote ${items.length} candidates to ${jsonPath}`);
