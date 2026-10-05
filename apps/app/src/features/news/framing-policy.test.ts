import { describe, expect, it } from 'vitest';

import { framingVerdict } from '@/features/news/framing-policy';

const APP = 'https://localhost';

describe('framingVerdict', () => {
  it('refuses X-Frame-Options DENY and SAMEORIGIN', () => {
    expect(framingVerdict({ 'x-frame-options': 'DENY' }, APP)).toBe('refused');
    expect(framingVerdict({ 'x-frame-options': 'sameorigin' }, APP)).toBe('refused');
    expect(framingVerdict({ 'x-frame-options': 'SAMEORIGIN, SAMEORIGIN' }, APP)).toBe('refused');
  });

  it('refuses frame-ancestors none and self, allows a list naming the app or a wildcard', () => {
    expect(
      framingVerdict(
        { 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" },
        APP,
      ),
    ).toBe('refused');
    expect(framingVerdict({ 'content-security-policy': "frame-ancestors 'self'" }, APP)).toBe(
      'refused',
    );
    expect(
      framingVerdict({ 'content-security-policy': 'frame-ancestors https://other.example' }, APP),
    ).toBe('refused');
    expect(
      framingVerdict(
        { 'content-security-policy': 'frame-ancestors https://localhost https://x.example' },
        APP,
      ),
    ).toBe('allowed');
    expect(framingVerdict({ 'content-security-policy': 'frame-ancestors *' }, APP)).toBe('allowed');
    expect(
      framingVerdict(
        { 'content-security-policy': 'frame-ancestors https://*.github.io' },
        'https://t-damer.github.io',
      ),
    ).toBe('allowed');
    expect(
      framingVerdict(
        { 'content-security-policy': 'frame-ancestors https://*.github.io' },
        'https://github.io.evil.example',
      ),
    ).toBe('refused');
  });

  it('allows pages that send neither header, and policies without frame-ancestors', () => {
    expect(framingVerdict({}, APP)).toBe('allowed');
    expect(framingVerdict({ 'content-security-policy': "default-src 'self'" }, APP)).toBe(
      'allowed',
    );
  });

  it('requires every policy of a combined header to allow the app', () => {
    const header = "frame-ancestors *, frame-ancestors 'none'";
    expect(framingVerdict({ 'content-security-policy': header }, APP)).toBe('refused');
  });
});
