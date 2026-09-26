import { describe, expect, it } from 'vitest';

import { quickToolsFromCatalog, resolveToolRefs } from '@/features/search/quick-tools';

describe('quick tools', () => {
  it('maps catalog tools and marks stored ids missing from the catalog', () => {
    const tools = quickToolsFromCatalog([
      {
        id: 'calc.bmi',
        icon: 'calculator',
        scope: 'calculators',
        title: 'ИМТ',
        description: '',
        aliases: [],
        group: 'general',
        href: '#/calculators/bmi',
      },
    ]);
    expect(tools[0]).toMatchObject({ id: 'calc.bmi', kindLabel: 'Калькулятор' });
    const resolved = resolveToolRefs(
      ['calc.bmi', 'tool.removed'],
      new Map(tools.map((tool) => [tool.id, tool])),
    );
    expect(resolved.map((entry) => [entry.id, entry.tool?.title])).toEqual([
      ['calc.bmi', 'ИМТ'],
      ['tool.removed', undefined],
    ]);
  });
});
