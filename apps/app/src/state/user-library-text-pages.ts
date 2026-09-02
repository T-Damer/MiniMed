export const USER_LIBRARY_TEXT_PAGE_BREAK = '\f';

export function normalizeUserLibraryTextPages(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

export function splitUserLibraryTextPages(value: string): readonly string[] {
  return normalizeUserLibraryTextPages(value).split(USER_LIBRARY_TEXT_PAGE_BREAK);
}

export function joinUserLibraryTextPages(pages: readonly string[]): string {
  return pages.join(USER_LIBRARY_TEXT_PAGE_BREAK);
}
