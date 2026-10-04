import { describe, expect, it } from 'vitest';

import { loadMfgCountries, parseMfgCountryCatalog } from './mfg-countries';
import {
  countryMarkText,
  formatTradeNameWithCountry,
  manufacturingBasis,
  manufacturingBasisTitle,
  manufacturingCountries,
  normalizeRegistrationKey,
} from './mfg-country';
import {
  normalizeCountryName,
  parseManufacturerStages,
  resolveManufacturingCountries,
} from './mfg-country-source';

const ALL_STAGES =
  'Производитель (Все стадии, включая выпускающий контроль качества),Аливус Лайф Сайенсиз Лимитед, Plot No 3109, GIDC, Ankleshwar City, Gujarat State, India, Индия';

describe('formatTradeNameWithCountry', () => {
  it('puts the country in brackets after the name', () => {
    expect(formatTradeNameWithCountry('Дроперидол', 'Россия')).toBe('Дроперидол (Россия)');
  });

  it('leaves the name alone when the country is unknown', () => {
    expect(formatTradeNameWithCountry('Дроперидол', null)).toBe('Дроперидол');
    expect(formatTradeNameWithCountry('Дроперидол', undefined)).toBe('Дроперидол');
    expect(formatTradeNameWithCountry('Дроперидол', '  ')).toBe('Дроперидол');
  });
});

describe('countryMarkText', () => {
  it('is empty without countries and lists a multi-site product', () => {
    expect(countryMarkText([])).toBeNull();
    expect(countryMarkText(['Россия'])).toBe('Россия');
    expect(countryMarkText(['Индия', 'Россия'])).toBe('Индия, Россия');
  });
});

describe('normalizeRegistrationKey', () => {
  it('reads every spelling of a «ЛП-№(…)-(РГ-RU)» number as one key', () => {
    const forms = [
      'ЛП-№(007733)-(РГ-RU)',
      'ЛП-№ (007733)-(РГ-RU)',
      'ЛП-N (007733)-(РГ-RU)',
      'ЛП-N(007733)-(РГ-RU)',
      'лп-№(007733)-(рг-ru)',
      'ЛП‑№(007733)-(РГ-RU)',
      ' ЛП-№(007733)-(РГ-RU) ',
    ];
    const keys = new Set(forms.map(normalizeRegistrationKey));
    expect(keys.size).toBe(1);
  });

  it('maps Latin look-alikes to Cyrillic and keeps digits as they are', () => {
    // Latin «Р» and «С» inside a Cyrillic number.
    expect(normalizeRegistrationKey('ЛCР-002968/10')).toBe(
      normalizeRegistrationKey('ЛСР-002968/10'),
    );
    expect(normalizeRegistrationKey('P N014471/01')).toBe(normalizeRegistrationKey('Р №014471/01'));
    expect(normalizeRegistrationKey('ЛП-007297')).not.toBe(normalizeRegistrationKey('ЛП-007279'));
  });

  it('does not merge different numbers', () => {
    expect(normalizeRegistrationKey('П N014471/01')).not.toBe(
      normalizeRegistrationKey('П N014471/02'),
    );
    expect(normalizeRegistrationKey('ЛП-000076')).not.toBe(normalizeRegistrationKey('ЛСР-000076'));
  });
});

describe('manufacturing lookup', () => {
  const catalog = parseMfgCountryCatalog({
    source: 'ГРЛС',
    sourceEdition: '02.10.2026',
    countries: ['Россия', 'Индия'],
    registrations: {
      'finished-form': { [normalizeRegistrationKey('ЛП-№(007733)-(РГ-RU)')]: 0 },
      holder: { [normalizeRegistrationKey('ЛП-001234')]: [1, 0] },
    },
  });

  it('finds a registration by any spelling of its number', () => {
    expect(manufacturingCountries(catalog, 'ЛП-N (007733)-(РГ-RU)')).toEqual(['Россия']);
    expect(manufacturingBasis(catalog, 'ЛП-№(007733)-(РГ-RU)')).toBe('finished-form');
  });

  it('keeps the order of a multi-site product and its basis', () => {
    expect(manufacturingCountries(catalog, 'ЛП-001234')).toEqual(['Индия', 'Россия']);
    expect(manufacturingBasis(catalog, 'ЛП-001234')).toBe('holder');
  });

  it('knows nothing about an unlisted number, or before the asset has loaded', () => {
    expect(manufacturingCountries(catalog, 'ЛП-999999')).toEqual([]);
    expect(manufacturingBasis(catalog, 'ЛП-999999')).toBeNull();
    expect(manufacturingCountries(undefined, 'ЛП-001234')).toEqual([]);
  });

  it('says which registry fact the country rests on', () => {
    expect(manufacturingBasisTitle('holder')).toContain('держателя');
    expect(manufacturingBasisTitle('finished-form')).toContain('готовой лекарственной формы');
    expect(manufacturingBasisTitle(null)).toBeUndefined();
  });
});

describe('parseMfgCountryCatalog', () => {
  it('rejects a malformed asset instead of returning an empty catalog', () => {
    expect(() => parseMfgCountryCatalog(null)).toThrow();
    expect(() => parseMfgCountryCatalog({ source: 'x', sourceEdition: 'e' })).toThrow();
    expect(() =>
      parseMfgCountryCatalog({
        source: 'x',
        sourceEdition: 'e',
        countries: ['Россия'],
        registrations: { holder: { A: 3 } },
      }),
    ).toThrow(/unknown country/u);
  });
});

describe('normalizeCountryName', () => {
  it('shortens the registry spellings to the name a physician reads', () => {
    expect(normalizeCountryName('Республика Беларусь')).toBe('Беларусь');
    expect(normalizeCountryName('Чешская Республика')).toBe('Чехия');
    expect(normalizeCountryName('Соединенное Королевство')).toBe('Великобритания');
    expect(normalizeCountryName('Соединенное Королевство Великобритании и Северной Ирландии')).toBe(
      'Великобритания',
    );
    expect(normalizeCountryName('Республика Корея')).toBe('Южная Корея');
    expect(normalizeCountryName('КНР')).toBe('Китай');
    expect(normalizeCountryName('Республика Хорватия')).toBe(normalizeCountryName('Хорватия'));
    expect(normalizeCountryName('Словацкая Республика')).toBe(normalizeCountryName('Словакия'));
  });

  it('keeps ordinary names and abbreviations, and drops placeholders', () => {
    expect(normalizeCountryName('Индия')).toBe('Индия');
    expect(normalizeCountryName('США')).toBe('США');
    expect(normalizeCountryName('~')).toBeNull();
    expect(normalizeCountryName('  ')).toBeNull();
    expect(normalizeCountryName(null)).toBeNull();
  });
});

describe('parseManufacturerStages', () => {
  it('reads a one-stage cell, taking the country after the last comma', () => {
    const [stage, ...rest] = parseManufacturerStages(ALL_STAGES);
    expect(rest).toEqual([]);
    expect(stage).toMatchObject({ kind: 'finished-form', rawCountry: 'Индия' });
  });

  it('splits a cell that lists several stages', () => {
    const stages = parseManufacturerStages(
      'Производитель (готовой ЛФ),АО "Завод", г. Москва, Россия Выпускающий контроль качества,Фарма ГмбХ, Berlin, Germany, Германия Упаковщик/фасовщик (вторичная/третичная упаковка),ООО "Упак", Тверь, Россия',
    );
    expect(stages.map((stage) => [stage.kind, stage.rawCountry])).toEqual([
      ['finished-form', 'Россия'],
      ['release-qc', 'Германия'],
      ['other', 'Россия'],
    ]);
  });

  it('classifies the labels the registry uses', () => {
    const kind = (label: string) =>
      parseManufacturerStages(`${label},Фирма, Город, Страна`)[0]?.kind;
    expect(kind('Производитель (Все стадии производства)')).toBe('finished-form');
    expect(kind('Все стадии')).toBe('finished-form');
    expect(kind('Производство готовой лекарственной формы')).toBe('finished-form');
    expect(kind('Выпускающий контроль качества')).toBe('release-qc');
    expect(kind('Упаковщик/фасовщик (в первичную упаковку)')).toBe('primary-packaging');
    expect(kind('Упаковщик/фасовщик (вторичная/третичная упаковка)')).toBe('other');
    expect(kind('Производитель растворителя')).toBe('other');
    expect(kind('Производитель фармацевтической субстанции')).toBe('other');
  });

  it('returns nothing for empty text or text without a stage label', () => {
    expect(parseManufacturerStages(null)).toEqual([]);
    expect(parseManufacturerStages('')).toEqual([]);
    expect(parseManufacturerStages('ООО «Завод», Россия')).toEqual([]);
  });
});

describe('resolveManufacturingCountries', () => {
  it('prefers the finished form over release control over primary packaging', () => {
    const cell = (label: string, country: string) => `${label},Фирма, адрес, ${country}`;
    expect(
      resolveManufacturingCountries({
        manufacturer: `${cell('Выпускающий контроль качества', 'Германия')} ${cell('Производитель (готовой ЛФ)', 'Индия')}`,
        holderCountry: 'Россия',
      }),
    ).toEqual({ countries: ['Индия'], basis: 'finished-form' });
    expect(
      resolveManufacturingCountries({
        manufacturer: `${cell('Упаковщик/фасовщик (в первичную упаковку)', 'Бельгия')} ${cell('Выпускающий контроль качества', 'Германия')}`,
        holderCountry: 'Россия',
      }),
    ).toEqual({ countries: ['Германия'], basis: 'release-qc' });
    expect(
      resolveManufacturingCountries({
        manufacturer: cell('Упаковщик/фасовщик (в первичную упаковку)', 'Бельгия'),
        holderCountry: 'Россия',
      }),
    ).toEqual({ countries: ['Бельгия'], basis: 'primary-packaging' });
  });

  it('lists every country of a multi-site product once, in order', () => {
    const cell = (country: string) => `Производитель (готовой ЛФ),Фирма, адрес, ${country}`;
    expect(
      resolveManufacturingCountries({
        manufacturer: `${cell('Индия')} ${cell('Россия')} ${cell('Индия')}`,
        holderCountry: null,
      }),
    ).toEqual({ countries: ['Индия', 'Россия'], basis: 'finished-form' });
  });

  it('falls back to the holder country when the stages do not make the product', () => {
    expect(
      resolveManufacturingCountries({
        manufacturer: 'Упаковщик/фасовщик (вторичная/третичная упаковка),ООО "Упак", Тверь, Россия',
        holderCountry: 'Республика Беларусь',
      }),
    ).toEqual({ countries: ['Беларусь'], basis: 'holder' });
    expect(resolveManufacturingCountries({ manufacturer: null, holderCountry: 'Индия' })).toEqual({
      countries: ['Индия'],
      basis: 'holder',
    });
  });

  it('is null when neither the stages nor the holder name a country', () => {
    expect(resolveManufacturingCountries({ manufacturer: null, holderCountry: null })).toBeNull();
    expect(resolveManufacturingCountries({ manufacturer: ALL_STAGES.slice(0, 20) })).toBeNull();
  });
});

describe('the bundled manufacturing-country asset', () => {
  it('loads once, names the source and resolves real registrations', async () => {
    const catalog = await loadMfgCountries();
    expect(await loadMfgCountries()).toBe(catalog);
    expect(catalog.sourceEdition).toMatch(/^\d{2}\.\d{2}\.\d{4}$/u);
    expect(catalog.entries.size).toBeGreaterThan(39_000);
    // A Russian ЛП-№ number, in two spellings, and an Indian finished-form maker.
    expect(manufacturingCountries(catalog, 'ЛП-№(007733)-(РГ-RU)')).toEqual(
      manufacturingCountries(catalog, 'ЛП-N (007733)-(РГ-RU)'),
    );
    expect(manufacturingCountries(catalog, 'ЛП-№(007733)-(РГ-RU)').length).toBeGreaterThan(0);
    expect(manufacturingCountries(catalog, 'ФС-000306')).toEqual(['Индия']);
    expect(manufacturingBasis(catalog, 'ФС-000306')).toBe('finished-form');
  });
});
