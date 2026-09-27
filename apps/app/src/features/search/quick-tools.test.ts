import { describe, expect, it } from 'vitest';

import {
  groupQuickTools,
  openQuickTool,
  type QuickTool,
  quickToolsFromCatalog,
  resolveToolRefs,
} from '@/features/search/quick-tools';

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

  it('groups tools by section in section order and drops empty sections', () => {
    const tool = (id: string, group?: QuickTool['group']): QuickTool => ({
      id,
      title: id,
      kindLabel: '',
      icon: 'calculator',
      ...(group ? { group } : {}),
    });
    const groups = groupQuickTools([
      tool('files.a', 'files'),
      tool('reception.a', 'reception'),
      tool('catalog.only'),
      tool('reception.b', 'reception'),
    ]);
    expect(groups.map((group) => [group.title, group.tools.map((item) => item.id)])).toEqual([
      ['Приём', ['reception.a', 'reception.b']],
      ['Файлы', ['files.a']],
    ]);
  });

  it('does not open a tool that is not available yet', () => {
    let opened = false;
    openQuickTool({
      id: 'x',
      title: 'x',
      kindLabel: '',
      icon: 'dice',
      run: () => {
        opened = true;
      },
      unavailableReason: 'Откроется, когда база будет готова',
    });
    expect(opened).toBe(false);
  });
});
