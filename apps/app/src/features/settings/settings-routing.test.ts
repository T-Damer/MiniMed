import { describe, expect, it } from 'vitest';

import {
  consumeRequestedSettingsPage,
  readSettingsRoute,
  requestSettingsPage,
  settingsPageHash,
  settingsParentHash,
} from '@/features/settings/settings-routing';

describe('settings routing', () => {
  it('reads the list and every sub-page', () => {
    expect(readSettingsRoute('#/settings')).toBe('index');
    expect(readSettingsRoute('#/settings/downloads')).toBe('downloads');
    expect(readSettingsRoute('#/settings/downloads/extra')).toBe('downloads');
    expect(readSettingsRoute('#/settings/general')).toBe('general');
    expect(readSettingsRoute('#/settings/images/reference')).toBe('reference-images');
    expect(readSettingsRoute('#/settings/unknown')).toBe('index');
    expect(readSettingsRoute('#/settings/ai/reference')).toBe('ai');
  });

  it('builds a hash for every page and the reference-images sub-page', () => {
    expect(settingsPageHash('ai')).toBe('#/settings/ai');
    expect(settingsPageHash('reference-images')).toBe('#/settings/images/reference');
  });

  it('leads back from a page to the list and from the reference images to «Изображения»', () => {
    expect(settingsParentHash('settings/downloads')).toBe('#/settings');
    expect(settingsParentHash('settings/appearance')).toBe('#/settings');
    expect(settingsParentHash('settings/images/reference')).toBe('#/settings/images');
    expect(settingsParentHash('settings')).toBeNull();
    expect(settingsParentHash('settings/unknown')).toBeNull();
    expect(settingsParentHash('notes')).toBeNull();
  });

  it('hands a requested page over once', () => {
    requestSettingsPage('general');
    expect(consumeRequestedSettingsPage()).toBe('general');
    expect(consumeRequestedSettingsPage()).toBeUndefined();
  });
});
