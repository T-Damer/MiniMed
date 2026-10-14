import { describe, expect, it } from 'vitest';

import { matchingCatalogTools, searchCatalogTools } from './searchCatalog';

// SRCH1 (QA 10-14): text with no real word in it returned fuzzy matches. The tool cards of «Все»
// are matched by words of the typed text, so a pasted tag or a keyboard smash finds no tool either.
describe('tool cards for text with no real word in it', () => {
  const tools = searchCatalogTools();
  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'asdfghjkl',
    'qwertyuiop',
    'zzzxxqqww',
    '!!!@@@###',
    'ъъъъъъ',
    'xkcdqzvbn',
    'фывапролдж',
  ])('finds no tool for %s', (query) => {
    expect(
      matchingCatalogTools(tools, 'all', undefined, query).filter((tool) => !tool.createsNew),
    ).toEqual([]);
  });
});
