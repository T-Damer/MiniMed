import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createDefinitionLookup,
  parseDefinitionCatalog,
} from '../../../packages/core/src/definition-catalog';
import { normalizeSurfaceText } from '../../../packages/search-lexical/src/normalize';

const root = new URL('../../../', import.meta.url);
const load = (path: string): unknown => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const starterInput = load('content/definition-drafts/catalog.json');
const bulkInput = load('content/definition-drafts/ruwiktionary-2026.9.16.json');
const corpus = parseDefinitionCatalog(bulkInput);
const start = performance.now();
const lookup = createDefinitionLookup(starterInput, bulkInput);
const buildMs = performance.now() - start;
assert.equal(corpus.terms.length, 6939);
assert.equal(lookup.termCount, 6975);
assert.equal(lookup.sourceCount, 6);
assert.equal(corpus.textKind, 'source-gloss');
assert.equal(corpus.sources[0]?.license, 'CC-BY-SA-4.0');
for (const term of corpus.terms) {
  assert.equal(term.references[0]?.source, 1001);
  assert.ok(term.definition.trim());
}
const forms = new Map<string, Set<string>>();
for (const term of corpus.terms) {
  const key = normalizeSurfaceText(term.title);
  const ids = forms.get(key) ?? new Set<string>();
  ids.add(term.id);
  forms.set(key, ids);
}
let first = 0;
let allVisible = 0;
const misses: { title: string; missingCount: number }[] = [];
const durations: number[] = [];
for (const [title, ids] of forms) {
  const before = performance.now();
  const hits = lookup.search(title, 20);
  durations.push(performance.now() - before);
  if (hits[0] && ids.has(hits[0].term.id)) first++;
  const missing = [...ids].filter((id) => !hits.some((hit) => hit.term.id === id));
  if (!missing.length) allVisible++;
  else misses.push({ title, missingCount: missing.length });
}

// Authored before inspecting the imported gloss texts. Do not insert these phrases as aliases.
// They are development coverage probes, not private clinician qualification.
const probes: readonly (readonly [string, string])[] = [
  ['затруднение проглатывания пищи', 'дисфагия'],
  ['не понимает речь после поражения мозга', 'афазия'],
  ['не может выполнить привычное целенаправленное движение', 'апраксия'],
  ['не узнает знакомые предметы при сохранном зрении', 'агнозия'],
  ['полностью перестал чувствовать запахи', 'аносмия'],
  ['моча совсем не образуется', 'анурия'],
  ['резко уменьшилось количество выделяемой мочи', 'олигурия'],
  ['слишком много мочи за сутки', 'полиурия'],
  ['постоянно испытывает сильную жажду', 'полидипсия'],
  ['кровь появляется в моче', 'гематурия'],
  ['обычные раздражители ощущаются чрезмерно сильно', 'гиперестезия'],
  ['снижена чувствительность к раздражителям', 'гипестезия'],
  ['нарушена координация движений', 'атаксия'],
  ['неправильно оценивает размах движения', 'дисметрия'],
  ['нечёткое произношение из-за нарушения работы речевых мышц', 'дизартрия'],
  ['автоматически повторяет чужие слова', 'эхолалия'],
  ['непроизвольно повторяет движения другого человека', 'эхопраксия'],
  ['не говорит при сохранённой возможности говорить', 'мутизм'],
  ['утратил способность получать удовольствие', 'ангедония'],
  ['нет побуждений к деятельности', 'абулия'],
  ['заполняет пробелы памяти вымышленными событиями', 'конфабуляция'],
  ['видит лица в узорах и пятнах', 'парейдолия'],
  ['собственная личность ощущается чужой', 'деперсонализация'],
  ['окружающий мир кажется ненастоящим', 'дереализация'],
  ['опущено верхнее веко', 'птоз'],
  ['один предмет видится двойным', 'диплопия'],
  ['зрачки сужены', 'миоз'],
  ['зрачок расширен', 'мидриаз'],
  ['зрачки разного размера', 'анизокория'],
  ['непроизвольные ритмичные движения глаз', 'нистагм'],
  ['трудно дышать лёжа и легче сидя', 'ортопноэ'],
  ['редкое дыхание', 'брадипноэ'],
  ['частые дыхательные движения', 'тахипноэ'],
  ['замедленный сердечный ритм', 'брадикардия'],
  ['учащённый сердечный ритм', 'тахикардия'],
  ['тканям не хватает кислорода', 'гипоксия'],
  ['кожа и слизистые синюшного цвета', 'цианоз'],
  ['свободная жидкость накапливается в брюшной полости', 'асцит'],
  ['ощущение вращения окружающих предметов', 'вертиго'],
  ['звон в ушах без внешнего звука', 'тиннитус'],
];
const allTerms = [...parseDefinitionCatalog(starterInput).terms, ...corpus.terms];
const probeResults = probes.map(([query, expected], index) => {
  const target = normalizeSurfaceText(expected);
  const ids = new Set(
    allTerms
      .filter((term) =>
        [term.title, ...term.aliases].some((name) => normalizeSurfaceText(name) === target),
      )
      .map((term) => term.id),
  );
  const hits = lookup.search(query, 20);
  const rank = hits.findIndex((hit) => ids.has(hit.term.id)) + 1;
  return {
    id: `bulk-reverse-${index + 1}`,
    expected,
    corpusPresent: ids.size > 0,
    rank: rank || null,
  };
});
durations.sort((a, b) => a - b);
const present = probeResults.filter((probe) => probe.corpusPresent);
const report = {
  schemaVersion: 1,
  corpusSenses: corpus.terms.length,
  mergedEntries: lookup.termCount,
  normalizedSourceNames: forms.size,
  sourceNameTop1: first,
  allSameNameSensesVisibleAt20: allVisible,
  nameMisses: misses,
  buildMs,
  lookupMs: {
    p50: durations[Math.floor(durations.length * 0.5)],
    p95: durations[Math.floor(durations.length * 0.95)],
  },
  currentProcessRssBytes: process.memoryUsage().rss,
  reverse: {
    total: probes.length,
    corpusPresent: present.length,
    top1: present.filter((p) => p.rank === 1).length,
    top5: present.filter((p) => p.rank !== null && p.rank <= 5).length,
    top20: present.filter((p) => p.rank !== null).length,
    probes: probeResults,
  },
  boundaries:
    'Whole-source name audit plus new authored reverse probes. Not an independent clinician benchmark, MedicalCore/SQLite integration test, browser timing, or Android measurement. Missing corpus and retrieval failures are counted separately; reverse metrics are informational and not tuned in this export.',
};
writeFileSync(
  new URL('docs/research/bulk-definition-quality-2026-09-21.json', root),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
