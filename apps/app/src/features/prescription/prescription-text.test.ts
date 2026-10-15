import { ROUTE_ORAL } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import type { UnitsPlan } from './dose-compute';
import {
  countText,
  durationPhrase,
  frequencyPhrase,
  gramsText,
  latinGenitive,
  latinStrength,
  routeOfForm,
  routeWord,
  rpLine,
  russianGenitive,
  signaText,
} from './prescription-text';
import { formKind } from './product-strength';

describe('numbers as a prescription writes them', () => {
  it('writes halves and grams the Latin way', () => {
    expect(countText(1.5)).toBe('1 1/2');
    expect(countText(0.5)).toBe('1/2');
    expect(countText(21)).toBe('21');
    expect(gramsText(500)).toBe('0,5');
    expect(gramsText(1000)).toBe('1,0');
    expect(gramsText(250)).toBe('0,25');
  });

  it('writes frequencies and durations in Russian', () => {
    expect(frequencyPhrase(3, 1)).toBe('3 раза в день');
    expect(durationPhrase(7)).toBe('в течение 7 дней');
    expect(durationPhrase(1)).toBe('в течение 1 дня');
    expect(durationPhrase(14)).toBe('в течение 2 недель');
    expect(durationPhrase(10)).toBe('в течение 10 дней');
  });
});

describe('names', () => {
  it('declines a Latin nominative into the genitive', () => {
    expect(latinGenitive('Amoxicillinum')).toBe('Amoxicillini');
    expect(latinGenitive('Paracetamolum')).toBe('Paracetamoli');
    expect(latinGenitive('Acidum acetylsalicylicum')).toBe('Acidi acetylsalicylici');
  });

  it('declines a Russian substance name for the Russian wording', () => {
    expect(russianGenitive('амоксициллин')).toBe('амоксициллина');
    expect(russianGenitive('ацетилсалициловая кислота')).toBe('ацетилсалициловой кислоты');
  });

  it('writes strengths in grams for solids and in mg for liquids', () => {
    expect(latinStrength('500 мг')).toBe('0,5');
    expect(latinStrength('250 мг/5 мл')).toBe('250 mg/5 ml');
  });
});

describe('the Rp line', () => {
  it('is Latin with the substance name, the strength in grams and the count', () => {
    expect(
      rpLine({
        latinName: 'Amoxicillinum',
        russianName: 'амоксициллин',
        form: 'таблетки',
        strength: '500 мг',
        quantity: 21,
        quantityKind: 'piece',
      }),
    ).toBe('Tab. Amoxicillini 0,5 N 21');
  });

  it('falls back to Russian in the genitive when there is no Latin name', () => {
    expect(
      rpLine({
        latinName: null,
        russianName: 'амоксициллин',
        form: 'таблетки',
        strength: '500 мг',
        quantity: 21,
        quantityKind: 'piece',
      }),
    ).toBe('Таблетки амоксициллина 500 мг N 21');
  });

  it('leaves out a dosage the registry does not state instead of printing its words', () => {
    for (const strength of ['НЕ УКАЗАНО', '1.0~']) {
      expect(
        rpLine({
          latinName: 'Amoxicillinum',
          russianName: 'амоксициллин',
          form: 'таблетки',
          strength,
          quantity: 21,
          quantityKind: 'piece',
        }),
      ).toBe('Tab. Amoxicillini N 21');
      expect(
        rpLine({
          latinName: null,
          russianName: 'амоксициллин',
          form: 'таблетки',
          strength,
          quantity: 21,
          quantityKind: 'piece',
        }),
      ).toBe('Таблетки амоксициллина N 21');
    }
  });
});

describe('the sign', () => {
  it('names the route, the units, the frequency and the course', () => {
    const text = signaText({
      form: 'таблетки',
      routeBits: ROUTE_ORAL,
      units: {
        kind: 'piece',
        piece: null,
        count: 1,
        step: 1,
        amount: 500,
        deviationPercent: 0,
        fromInstruction: false,
      },
      singleAmount: { value: 500, unit: 'mg' },
      intakesPerDay: 3,
      periodDays: 1,
      days: 7,
    });
    expect(text.startsWith('Внутрь по 1 таблетк')).toBe(true);
    expect(text).toContain('3 раза в день');
    expect(text.endsWith('в течение 7 дней.')).toBe(true);
  });

  it('names only the default route of a tablet when nothing else is known', () => {
    expect(
      signaText({
        form: 'таблетки',
        routeBits: 0,
        units: null,
        singleAmount: null,
        intakesPerDay: null,
        periodDays: 1,
        days: null,
      }),
    ).toBe('Внутрь.');
  });
});

describe('the route comes from the dosage form when the sentence names none (RX3 audit)', () => {
  const route = (form: string, bits = 0) => routeWord(bits, formKind(form), form);

  it('is never «Внутрь» for a suppository, a vaginal or sublingual tablet, a lozenge or drops', () => {
    expect(route('суппозитории ректальные')).toBe('Ректально');
    expect(route('суппозитории вагинальные')).toBe('Вагинально');
    expect(route('таблетки вагинальные')).toBe('Вагинально');
    expect(route('таблетки подъязычные')).toBe('Под язык');
    expect(route('таблетки подъязычные гомеопатические')).toBe('Под язык');
    expect(route('таблетки для рассасывания')).toBe('Рассасывать');
    expect(route('пастилки')).toBe('Рассасывать');
    expect(route('капли глазные')).toBe('В конъюнктивальный мешок');
    expect(route('капли ушные')).toBe('В ухо');
    expect(route('спрей назальный')).toBe('В нос');
    expect(route('мазь для наружного применения')).toBe('Наружно');
    expect(route('раствор для внутримышечного введения')).toBe('Внутримышечно');
  });

  it('keeps «Внутрь» for oral forms and says nothing for a suppository the wording does not place', () => {
    expect(route('таблетки, покрытые пленочной оболочкой')).toBe('Внутрь');
    expect(route('капли для приема внутрь')).toBe('Внутрь');
    expect(route('суппозитории')).toBeNull();
    expect(routeOfForm('суппозитории')).toBeNull();
  });

  it('lets the sentence name a route for a form that does not', () => {
    expect(route('таблетки', 128)).toBe('Под язык');
    expect(route('раствор для инфузий', 2)).toBe('Внутривенно');
  });

  it('writes the sign of the audit’s lozenge and rectal suppository without «Внутрь»', () => {
    const units: UnitsPlan = {
      kind: 'piece',
      piece: null,
      count: 1,
      step: 1,
      amount: null,
      deviationPercent: null,
      fromInstruction: true,
    };
    const sign = (form: string, routeBits: number) =>
      signaText({
        form,
        routeBits,
        units,
        singleAmount: null,
        intakesPerDay: 2,
        periodDays: 1,
        days: null,
      });
    expect(sign('суппозитории ректальные', 0)).toBe('Ректально по 1 суппозиторию 2 раза в день.');
    expect(sign('таблетки для рассасывания', 32)).toBe('Рассасывать по 1 таблетке 2 раза в день.');
  });
});

describe('what the instruction counts is named as the instruction names it (RX3 audit: «1 шт.»)', () => {
  const plan = (piece: UnitsPlan['piece'], count: number): UnitsPlan => ({
    kind: 'piece',
    piece,
    count,
    step: 1,
    amount: null,
    deviationPercent: null,
    fromInstruction: true,
  });
  const sign = (form: string, units: UnitsPlan, amount: number | null = null) =>
    signaText({
      form,
      routeBits: ROUTE_ORAL,
      units,
      singleAmount: amount === null ? null : { value: amount, unit: 'ml' },
      intakesPerDay: 3,
      periodDays: 1,
      days: null,
    });

  it('says a spoon for a syrup, with the volume the instruction gives', () => {
    expect(sign('сироп', plan('tablespoon', 1))).toBe('Внутрь по 1 столовой ложке 3 раза в день.');
    expect(sign('сироп', plan('teaspoon', 0.5), 2.5)).toBe(
      'Внутрь по 1/2 чайной ложки (2,5 мл) 3 раза в день.',
    );
    expect(sign('сироп', plan('measure', 2), 10)).toBe(
      'Внутрь по 2 мерные ложки (10 мл) 3 раза в день.',
    );
    expect(sign('сироп', plan('teaspoon', 5))).toBe('Внутрь по 5 чайных ложек 3 раза в день.');
    expect(sign('сироп', plan('cap', 1))).toBe('Внутрь по 1 мерному колпачку 3 раза в день.');
  });

  it('says an ampoule or a vial, not a piece', () => {
    expect(
      signaText({
        form: 'раствор для внутримышечного введения',
        routeBits: 0,
        units: plan('ampoule', 1),
        singleAmount: null,
        intakesPerDay: 1 / 7,
        periodDays: 7,
        days: null,
      }),
    ).toBe('Внутримышечно по 1 ампуле 1 раз в неделю.');
    expect(sign('раствор для инъекций', plan('vial', 2))).toContain('по 2 флакона');
  });

  it('keeps the piece word of the dosage form when the instruction names none', () => {
    expect(sign('таблетки', plan(null, 2))).toBe('Внутрь по 2 таблетки 3 раза в день.');
  });
});
