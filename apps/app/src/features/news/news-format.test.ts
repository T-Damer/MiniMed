import { describe, expect, it } from 'vitest';

import { relativeTimeLabel, shortSourceName } from '@/features/news/news-format';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const ago = (ms: number): number => NOW - ms;

describe('relativeTimeLabel', () => {
  it('counts minutes, hours and days the way a social feed does', () => {
    expect(relativeTimeLabel(ago(10_000), NOW)).toBe('сейчас');
    expect(relativeTimeLabel(ago(5 * 60_000), NOW)).toBe('5 мин');
    expect(relativeTimeLabel(ago(59 * 60_000), NOW)).toBe('59 мин');
    expect(relativeTimeLabel(ago(3 * 3_600_000), NOW)).toBe('3 ч');
    expect(relativeTimeLabel(ago(30 * 3_600_000), NOW)).toBe('вчера');
    expect(relativeTimeLabel(ago(4 * 86_400_000), NOW)).toBe('4 д');
  });

  it('falls back to the date, with the year only when it differs', () => {
    expect(relativeTimeLabel(Date.parse('2026-09-20T12:00:00Z'), NOW)).toMatch(/сент/u);
    expect(relativeTimeLabel(Date.parse('2025-09-20T12:00:00Z'), NOW)).toMatch(/2025/u);
  });

  it('treats a time in the future as just now', () => {
    expect(relativeTimeLabel(NOW + 60_000, NOW)).toBe('сейчас');
  });
});

describe('shortSourceName', () => {
  it('cuts the descriptive tail after a dash', () => {
    expect(shortSourceName('Росздравнадзор — новости')).toBe('Росздравнадзор');
    expect(shortSourceName('ВОЗ — новости (на русском)')).toBe('ВОЗ');
    expect(shortSourceName('Medical Xpress')).toBe('Medical Xpress');
    expect(shortSourceName('PubMed: glaucoma')).toBe('PubMed: glaucoma');
    expect(shortSourceName('NEJM-feed')).toBe('NEJM-feed');
  });
});
