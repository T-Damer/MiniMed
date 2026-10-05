import { describe, expect, it } from 'vitest';

import {
  filterSettingsPages,
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  settingsPage,
} from '@/features/settings/settings-pages';

describe('settings pages', () => {
  it('lists every page exactly once in the groups', () => {
    const grouped = SETTINGS_GROUPS.flat();
    expect([...grouped].sort()).toEqual(SETTINGS_PAGES.map((page) => page.id).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(settingsPage('ai').title).toBe('Функции ИИ');
  });

  it('filters by title, description and card keywords', () => {
    expect(filterSettingsPages('')).toHaveLength(SETTINGS_PAGES.length);
    expect(filterSettingsPages('экг').map((page) => page.id)).toEqual(['ai']);
    expect(filterSettingsPages('ТЕМА').map((page) => page.id)).toEqual(['appearance']);
    expect(filterSettingsPages('резервная копия').map((page) => page.id)).toEqual(['data']);
    expect(filterSettingsPages('несуществующее')).toEqual([]);
  });
});
