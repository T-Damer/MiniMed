import { describe, expect, it } from 'vitest';

import { readSettingsRoute, settingsParentHash } from '@/features/settings/settings-routing';

describe('settings routing', () => {
  it('treats downloads as a settings sub-route', () => {
    expect(readSettingsRoute('#/settings')).toBe('index');
    expect(readSettingsRoute('#/settings/downloads')).toBe('downloads');
    expect(readSettingsRoute('#/settings/downloads/extra')).toBe('downloads');
  });

  it('returns the settings root as the downloads parent', () => {
    expect(settingsParentHash('settings/downloads')).toBe('#/settings');
    expect(settingsParentHash('settings')).toBeNull();
  });
});
