import { describe, expect, it } from 'vitest';

import { avatarHue, avatarInitials, avatarLook } from '@/features/news/news-avatar';
import { iconKeyFor } from '@/features/news/news-icons';
import { bundledAvatarHosts } from '@/features/news/suggested-avatars';
import { SUGGESTED_FEEDS } from '@/features/news/suggested-feeds';

const DATA = 'data:image/png;base64,iVBORwECAwQ=';

describe('monogram', () => {
  it('takes the first letters of the first two words', () => {
    expect(avatarInitials('Росздравнадзор — новости')).toBe('РН');
    expect(avatarInitials('STAT')).toBe('S');
    expect(avatarInitials('  «Медицинская газета»  ')).toBe('МГ');
    expect(avatarInitials('— — —')).toBe('?');
  });

  it('colours a name the same way every time, within the hue circle', () => {
    expect(avatarHue('Medical Xpress')).toBe(avatarHue('  medical xpress '));
    expect(avatarHue('a')).not.toBe(avatarHue('b'));
    for (const name of ['', 'x', 'Фармвестник', 'The Lancet']) {
      expect(avatarHue(name)).toBeGreaterThanOrEqual(0);
      expect(avatarHue(name)).toBeLessThan(360);
    }
  });
});

describe('avatarLook', () => {
  it('prefers the fetched icon, then the bundled one, then a monogram', () => {
    const icons = { 'blog.test': DATA };
    expect(avatarLook('Blog', 'https://blog.test/feed', icons).src).toBe(DATA);
    expect(avatarLook('Who', 'https://www.who.int/ru/news', {}).src).toMatch(/^data:image\/png/u);
    const plain = avatarLook('Тихий источник', 'https://quiet.test/', {});
    expect(plain.src).toBeUndefined();
    expect(plain.mark).toBe('ТИ');
  });

  it('keeps the bundled mark and hue of a suggested source', () => {
    const suggested = SUGGESTED_FEEDS[0];
    if (!suggested) throw new Error('no suggested feeds');
    const look = avatarLook(suggested.title, suggested.siteUrl, {}, suggested.id);
    expect(look.hue).toBe(suggested.visual.hue);
    expect(look.mark).toBe(suggested.visual.mark);
  });
});

describe('bundled avatars', () => {
  it('belong to suggested sources only, and most suggested sources have one', () => {
    const hosts = new Set(SUGGESTED_FEEDS.map((feed) => iconKeyFor(feed.siteUrl)));
    for (const host of bundledAvatarHosts()) expect(hosts.has(host)).toBe(true);
    expect(bundledAvatarHosts().length).toBeGreaterThanOrEqual(8);
  });
});
