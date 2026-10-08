import { resolvedTheme } from '@/state/theme';

/** Style key of the app-theme sheet inside every EPUB chapter frame. */
export const EPUB_THEME_STYLE_KEY = 'minimed-app-theme';

export interface EpubThemeColors {
  readonly dark: boolean;
  readonly text: string;
  readonly background: string;
  readonly link: string;
}

/** Values that go into a style sheet must not be able to end a declaration or a rule. */
function safeColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  return /^[#a-z0-9(),.%\s/-]+$/iu.test(trimmed) && trimmed ? trimmed : fallback;
}

/**
 * The style sheet that makes a book follow the app theme. Chapters bring their own colours (most
 * assume a white page), so the page and text colours are forced; in the dark theme the colours of
 * inner elements are forced too, otherwise dark text sits on the dark page.
 */
export function epubThemeCss(colors: EpubThemeColors): string {
  const text = safeColor(colors.text, colors.dark ? '#eee5d4' : '#2b2823');
  const background = safeColor(colors.background, colors.dark ? '#372e26' : '#fbf7ea');
  const link = safeColor(colors.link, colors.dark ? '#9bc7a7' : '#2f5f55');
  const rules = [
    `html { color-scheme: ${colors.dark ? 'dark' : 'light'}; background: ${background} !important; }`,
    `body { background: ${background} !important; color: ${text} !important; }`,
  ];
  if (colors.dark) {
    rules.push(
      `body * { color: inherit !important; background-color: transparent !important; border-color: ${text} !important; }`,
      `a, a * { color: ${link} !important; }`,
    );
  }
  return rules.join('\n');
}

/** Whether the app is in its dark theme (the chosen one, or the system colour scheme). */
export function appPrefersDark(): boolean {
  return resolvedTheme() === 'dark';
}

/** The colours the reader page itself uses, read from the element the book is rendered into. */
export function readEpubThemeColors(host: HTMLElement): EpubThemeColors {
  const style = getComputedStyle(host);
  const variable = (name: string): string => style.getPropertyValue(name).trim();
  return {
    dark: appPrefersDark(),
    text: variable('--theme-text'),
    background: style.backgroundColor,
    link: variable('--theme-link'),
  };
}
