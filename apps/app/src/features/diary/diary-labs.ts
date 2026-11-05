/**
 * Lab tests a doctor often asks for during psychiatric treatment, and the medicines that call for
 * them (DIARY27, owner 2026-11-04: «some drugs increase hormone levels — prolactin»). The editor
 * offers the ones the plan's medicines call for first, with the reason; the doctor may type any
 * other test. Units are the ones Russian labs print most often.
 */
export interface LabPreset {
  readonly name: string;
  readonly unit: string;
  /** Lower-case stems of medicine names (trade names included) that call for this test. */
  readonly drugs: readonly string[];
  /** Why, for the patient: said after the medicine's name. */
  readonly reason: string;
}

export const LAB_PRESETS: readonly LabPreset[] = [
  {
    name: 'Пролактин',
    unit: 'мМЕ/л',
    drugs: [
      'рисперид',
      'рисполепт',
      'палиперид',
      'инвега',
      'ксеплион',
      'амисульпр',
      'солиан',
      'сульпирид',
      'эглонил',
      'галоперид',
    ],
    reason: 'может повышать пролактин',
  },
  {
    name: 'Глюкоза натощак',
    unit: 'ммоль/л',
    drugs: ['оланзап', 'зипрекс', 'клозап', 'азалептин', 'кветиап', 'сероквел'],
    reason: 'может менять обмен веществ',
  },
  {
    name: 'Холестерин общий',
    unit: 'ммоль/л',
    drugs: ['оланзап', 'зипрекс', 'клозап', 'азалептин', 'кветиап', 'сероквел'],
    reason: 'может повышать холестерин',
  },
  {
    name: 'Литий в крови',
    unit: 'ммоль/л',
    drugs: ['лити', 'седалит', 'контемнол'],
    reason: 'нужна его концентрация в крови',
  },
  {
    name: 'ТТГ',
    unit: 'мМЕ/л',
    drugs: ['лити', 'седалит', 'контемнол'],
    reason: 'влияет на щитовидную железу',
  },
  {
    name: 'Креатинин',
    unit: 'мкмоль/л',
    drugs: ['лити', 'седалит', 'контемнол'],
    reason: 'нужно следить за работой почек',
  },
  {
    name: 'Вальпроевая кислота в крови',
    unit: 'мкг/мл',
    drugs: ['вальпро', 'депакин', 'конвулекс', 'энкорат'],
    reason: 'нужна её концентрация в крови',
  },
  {
    name: 'АЛТ',
    unit: 'Ед/л',
    drugs: ['вальпро', 'депакин', 'конвулекс', 'энкорат', 'карбамазеп', 'финлепсин', 'тегретол'],
    reason: 'нужно следить за печенью',
  },
  {
    name: 'Натрий',
    unit: 'ммоль/л',
    drugs: ['карбамазеп', 'финлепсин', 'тегретол', 'окскарбазеп', 'трилептал'],
    reason: 'может снижать натрий в крови',
  },
  {
    name: 'Нейтрофилы',
    unit: '×10⁹/л',
    drugs: ['клозап', 'азалептин'],
    reason: 'нужен контроль крови',
  },
];

export interface LabSuggestion {
  readonly preset: LabPreset;
  /** «Рисперидон может повышать пролактин»; absent for a test no medicine of the plan calls for. */
  readonly why?: string;
}

/**
 * The presets for these medicine names: the ones a medicine calls for first, each with its reason,
 * then the others; tests already asked for are left out.
 */
export function labSuggestions(
  medicines: readonly string[],
  asked: readonly string[],
): LabSuggestion[] {
  const taken = new Set(asked.map((name) => name.trim().toLocaleLowerCase('ru')));
  const called: LabSuggestion[] = [];
  const rest: LabSuggestion[] = [];
  for (const preset of LAB_PRESETS) {
    if (taken.has(preset.name.toLocaleLowerCase('ru'))) continue;
    const medicine = medicines.find((name) => {
      const lower = name.toLocaleLowerCase('ru');
      return preset.drugs.some((stem) => lower.includes(stem));
    });
    if (medicine) {
      const name = medicine.trim();
      called.push({
        preset,
        why: `${name[0]?.toUpperCase() ?? ''}${name.slice(1)} ${preset.reason}`,
      });
    } else rest.push({ preset });
  }
  return [...called, ...rest];
}
