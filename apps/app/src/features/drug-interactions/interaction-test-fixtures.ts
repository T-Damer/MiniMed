/** A small, real-shaped index built through the real builder, shared by the unit tests. */
import { type BuildInputDocument, createInteractionBuilder } from './interaction-build';
import {
  createInteractionIndex,
  type InteractionIndex,
  parseInteractionIndex,
} from './interaction-index';

export const FIXTURE_ATC: Readonly<Record<string, string>> = {
  B01: 'Антитромботические средства',
  B01A: 'Антитромботические средства',
  B01AA: 'Антагонисты витамина K',
  M01: 'Противовоспалительные и противоревматические препараты',
  M01A: 'Нестероидные противовоспалительные и противоревматические препараты',
  M01AE: 'Производные пропионовой кислоты',
  N02: 'Анальгетики',
  N02B: 'Другие анальгетики и антипиретики',
  N02BA: 'Салициловая кислота и ее производные',
};

export const SECTION_TEXT = {
  warfarinInteractions: [
    'Омепразол Усиление антикоагулянтного эффекта варфарина.',
    'С нестероидными противовоспалительными препаратами',
    'Повышенный риск кровотечений при одновременном приеме с ибупрофеном и этанолом.',
    'Прочие лекарственные средства могут изменять эффект.',
  ].join('\n'),
  ibuprofenInteractions: [
    'Ацетилсалициловая кислота: возможно снижение кардиопротективного действия ибупрофена.',
    'Антикоагулянты (варфарин) — увеличение риска кровотечений.',
  ].join('\n'),
  ibuprofenSpecial: 'Как и другие НПВП, ибупрофен следует применять с осторожностью.',
  aspirinInteractions: 'Нет значимых данных.',
} as const;

function document(
  id: string,
  tradeName: string,
  registration: string,
  sections: readonly { id: string; type: string; title: string; text: string }[],
  kind = 'national-instruction',
): BuildInputDocument {
  return {
    id,
    title: `${tradeName}: инструкция`,
    kind,
    sourceClass: 'grls',
    tradeName,
    inn: null,
    registrationKeys: [registration],
    sections: sections.map((section) => ({
      id: section.id,
      type: section.type,
      title: section.title,
      chunks: () => [section.text],
    })),
  };
}

export function buildFixtureIndex(): InteractionIndex {
  const builder = createInteractionBuilder({
    cards: [
      {
        id: 'esklp.mnn.варфарин',
        name: 'ВАРФАРИН',
        synonyms: [],
        components: [],
        atcCodes: ['B01AA03'],
        registrationKeys: ['ЛП-001'],
      },
      {
        id: 'esklp.mnn.ибупрофен',
        name: 'ИБУПРОФЕН',
        synonyms: [],
        components: [],
        atcCodes: ['M01AE01'],
        registrationKeys: ['ЛП-002'],
      },
      {
        id: 'esklp.mnn.ацетилсалициловая-кислота',
        name: 'АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА',
        synonyms: [],
        components: [],
        atcCodes: ['N02BA01'],
        registrationKeys: ['ЛП-003'],
      },
      {
        id: 'esklp.mnn.омепразол',
        name: 'ОМЕПРАЗОЛ',
        synonyms: [],
        components: [],
        atcCodes: ['A02BC01'],
        registrationKeys: ['ЛП-004'],
      },
    ],
    atcNames: FIXTURE_ATC,
    atcBasis: { version: 'test', publishDate: '2026-01-01' },
    classAliases: [{ text: 'НПВП', codes: ['M01A'], basis: 'test' }],
  });
  builder.addModule(
    { id: 'minimed.medications.instructions.test.ru', version: 't1', sha256: 'sha256:x' },
    [
      document('drug.rf.aaaa.instruction', 'Варфарин-тест', 'ЛП-001', [
        {
          id: 'section.1111111111111111',
          type: 'interactions',
          title: 'Взаимодействие с другими лекарственными средствами',
          text: SECTION_TEXT.warfarinInteractions,
        },
      ]),
      document('drug.rf.bbbb.instruction', 'Ибупрофен-тест', 'ЛП-002', [
        {
          id: 'section.2222222222222222',
          type: 'interactions',
          title: 'Взаимодействие с другими лекарственными средствами',
          text: SECTION_TEXT.ibuprofenInteractions,
        },
        {
          id: 'section.3333333333333333',
          type: 'special-instructions',
          title: 'Особые указания',
          text: SECTION_TEXT.ibuprofenSpecial,
        },
      ]),
      document('drug.rf.cccc.instruction', 'Аспирин-тест', 'ЛП-003', [
        {
          id: 'section.4444444444444444',
          type: 'interactions',
          title: 'Взаимодействие с другими лекарственными средствами',
          text: SECTION_TEXT.aspirinInteractions,
        },
      ]),
    ],
  );
  const { asset } = builder.finish();
  return createInteractionIndex(parseInteractionIndex(JSON.parse(JSON.stringify(asset))));
}
