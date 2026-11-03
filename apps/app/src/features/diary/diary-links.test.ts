import { describe, expect, it } from 'vitest';

import { isPublishedHost } from '@/features/diary/diary-links';

describe('diary links', () => {
  it('sends the pages on GitHub and GitVerse Pages to the pilot service', () => {
    expect(isPublishedHost('t-damer.github.io')).toBe(true);
    expect(isPublishedHost('t-damer.gitverse.site')).toBe(true);
    expect(isPublishedHost('med.1damer.com')).toBe(false);
    expect(isPublishedHost('127.0.0.1')).toBe(false);
  });
});
