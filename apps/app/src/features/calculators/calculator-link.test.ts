import type { CalculatorInputDefinition } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

const { calculatorLinkValues, calculatorRouteQuery, calculatorShareBase, calculatorShareUrl } =
  await import('@/features/calculators/calculator-link');

const inputs = [
  {
    id: 'tremor',
    label: 'Тремор',
    kind: 'select',
    options: [0, 1, 4, 7].map((value) => ({ value, label: String(value) })),
  },
  { id: 'age', label: 'Возраст', kind: 'number', minimum: 0, maximum: 120, integer: true },
  { id: 'seizures', label: 'Судороги', kind: 'checkbox' },
] as unknown as readonly CalculatorInputDefinition[];

describe('calculator links', () => {
  it('carries the values that fit the inputs and reads them back', () => {
    const url = calculatorShareUrl({
      calculatorId: 'minimed.calculator.ciwa-ar',
      inputs,
      values: { tremor: 4, age: 45, seizures: true, patientName: 'Иванов', ignored: '' },
      base: 'https://t-damer.gitverse.site/minimed/',
    });
    expect(url).toBe(
      'https://t-damer.gitverse.site/minimed/index.html?share=tool#/calculators/minimed.calculator.ciwa-ar?tremor=4&age=45&seizures=1',
    );
    const hash = new URL(url).hash;
    expect(calculatorLinkValues(calculatorRouteQuery(hash), inputs)).toEqual({
      tremor: '4',
      age: '45',
      seizures: '1',
    });
  });

  it('drops values a hand-edited link puts outside the form', () => {
    expect(calculatorLinkValues('tremor=5&age=300&seizures=yes&other=1', inputs)).toEqual({});
    expect(calculatorRouteQuery('#/calculators/minimed.calculator.ciwa-ar')).toBe('');
  });

  it('an empty calculator is a link without values', () => {
    expect(
      calculatorShareUrl({ calculatorId: 'x.y', inputs, base: 'http://127.0.0.1:5173/' }),
    ).toBe('http://127.0.0.1:5173/index.html?share=tool#/calculators/x.y');
  });

  it('points published pages and the native app at GitVerse, a local page at itself', () => {
    const at = (hostname: string, origin: string, pathname: string) =>
      calculatorShareBase({ hostname, origin, pathname }, false);
    expect(at('t-damer.github.io', 'https://t-damer.github.io', '/MiniMed/app/index.html')).toBe(
      'https://t-damer.gitverse.site/minimed/',
    );
    expect(at('127.0.0.1', 'http://127.0.0.1:5173', '/')).toBe('http://127.0.0.1:5173/');
    expect(
      calculatorShareBase(
        { hostname: 'localhost', origin: 'https://localhost', pathname: '/' },
        true,
      ),
    ).toBe('https://t-damer.gitverse.site/minimed/');
  });
});
