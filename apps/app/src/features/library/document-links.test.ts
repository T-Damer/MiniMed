import { describe, expect, it } from 'vitest';

import { documentLinkAllowed } from '@/features/library/document-links';

describe('documentLinkAllowed', () => {
  it('keeps web, mail, phone and in-document links', () => {
    for (const href of [
      'https://example.org/a',
      'http://x.ru',
      'mailto:a@b.ru',
      'tel:+7900',
      '#p2',
    ]) {
      expect(documentLinkAllowed(href)).toBe(true);
    }
  });

  it('drops script and other schemes, also with a tab or case tricks inside the scheme', () => {
    for (const href of [
      'javascript:alert(1)',
      'java\tscript:alert(1)',
      ' JavaScript:alert(1)',
      'vbscript:x',
      'data:text/html,<script>x</script>',
      'file:///etc/passwd',
      'intent://x#Intent;end',
    ]) {
      expect(documentLinkAllowed(href)).toBe(false);
    }
  });
});
