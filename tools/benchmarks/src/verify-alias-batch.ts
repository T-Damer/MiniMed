import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

const CASES: readonly { readonly id: string; readonly query: string; readonly expectedDocumentId: string }[] = [
  { id: 'nasal-flaring', query: 'Ребенок 8 месяцев, раздувает ноздри при дыхании, температура 38.5', expectedDocumentId: 'kr.rf.714_2.pneumonia' },
  { id: 'chest-pain-pneumonia', query: 'Кашель неделю, болит в грудной клетке при кашле, температура держится', expectedDocumentId: 'kr.rf.714_2.pneumonia' },
  { id: 'apnea-infant', query: 'Грудничок иногда перестает дышать на несколько секунд, кашель', expectedDocumentId: 'kr.rf.714_2.pneumonia' },
  { id: 'cyanosis', query: 'Ребенок кашляет, губы синеют при плаче', expectedDocumentId: 'kr.rf.714_2.pneumonia' },
  { id: 'bulging-fontanelle', query: 'Грудничок вялый, родничок выбухает, температура 39', expectedDocumentId: 'kr.rf.58_2.meningococcal' },
  { id: 'monotone-cry', query: 'Младенец плачет на одной ноте уже час, не берет грудь', expectedDocumentId: 'kr.rf.58_2.meningococcal' },
  { id: 'severe-headache-meningeal', query: 'Ребенок 10 лет, сильно болит голова и тошнит, температура 39.5', expectedDocumentId: 'kr.rf.58_2.meningococcal' },
  { id: 'abdominal-rumbling', query: 'Живот урчит второй день, понос и температура', expectedDocumentId: 'kr.rf.755_1.rotavirus' },
  { id: 'poor-appetite', query: 'Ребенок плохо ест второй день, рвота, вялый', expectedDocumentId: 'kr.rf.755_1.rotavirus' },
  { id: 'cloudy-urine', query: 'У дочки моча стала мутная и воняет, больно писать', expectedDocumentId: 'kr.rf.281_3.uti' },
  { id: 'urgency', query: 'Ребенок 6 лет резко хочет в туалет и не успевает добежать, температура', expectedDocumentId: 'kr.rf.281_3.uti' },
  { id: 'daytime-wetting', query: 'Девочка 5 лет писается днем хотя раньше не было такого', expectedDocumentId: 'kr.rf.281_3.uti' },
  { id: 'chills', query: 'Взрослого трясет от температуры, боль в пояснице', expectedDocumentId: 'kr.rf.281_3.uti' },
  { id: 'disturbed-consciousness', query: 'Ребенок стал заторможенным и плохо реагирует, сыпь на ногах', expectedDocumentId: 'kr.rf.58_2.meningococcal' },
];

const root = resolve(import.meta.dirname, '../../..');
const databaseBytes = new Uint8Array(readFileSync(resolve(root, 'data/build/rf-public-pilot.db')));
const store = await SqliteMedicalStore.createFromBytes(databaseBytes);
const core = createMedicalCore({ store, platform: 'test', embedder: new PortableHashEmbedder() });
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

let failures = 0;
for (const testCase of CASES) {
  const response = await core.search({
    query: testCase.query,
    mode: 'hybrid',
    filters: {},
    limit: 5,
    includeSuggestions: false,
  });
  if (!response.ok) {
    console.log(`FAIL ${testCase.id}: search error ${response.error.message}`);
    failures += 1;
    continue;
  }
  const topDocuments = response.value.groups.map((group) => group.documentId);
  const rank = topDocuments.indexOf(testCase.expectedDocumentId);
  const ok = rank === 0;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${testCase.id.padEnd(28)} rank=${rank < 0 ? 'not found' : rank + 1} top=[${topDocuments.slice(0, 3).join(', ')}]`,
  );
}
console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
if (failures > 0) process.exitCode = 1;
