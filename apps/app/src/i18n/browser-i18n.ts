import enMessages from '../../_locales/en/messages.json';
import ruMessages from '../../_locales/ru/messages.json';

export interface I18nPlaceholder {
  readonly content: string;
  readonly example?: string;
}

export interface I18nMessage {
  readonly message: string;
  readonly description?: string;
  readonly placeholders?: Readonly<Record<string, I18nPlaceholder>>;
}

export type LocaleCatalog = Readonly<Record<string, I18nMessage>>;

export interface GetMessageOptions {
  readonly escapeValue?: boolean;
}

export interface DetectedLanguage {
  readonly language: string;
  readonly percentage: number;
}

export interface BrowserI18n {
  getMessage(
    messageName: string,
    substitutions?: string | readonly string[],
    options?: GetMessageOptions,
  ): string;
  getUILanguage(): string;
  detectLanguage(text: string): readonly DetectedLanguage[];
}

const DEFAULT_UI_LANGUAGE = 'ru';

let uiLanguageOverride: string | undefined;

const catalogs: Readonly<Record<'ru' | 'en', LocaleCatalog>> = {
  ru: ruMessages,
  en: enMessages,
};

function resolveCatalogLanguage(uiLanguage: string): 'ru' | 'en' {
  const normalized = uiLanguage.toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  return 'ru';
}

function substitutionList(
  substitutions?: string | readonly string[],
): readonly string[] | undefined {
  if (substitutions === undefined) return undefined;
  if (typeof substitutions === 'string') return [substitutions];
  return substitutions;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function applySubstitutions(
  template: string,
  substitutions: readonly string[] | undefined,
  escapeValue: boolean,
): string {
  if (!substitutions || substitutions.length === 0) return template;
  return substitutions.reduce((message, substitution, index) => {
    const value = escapeValue ? escapeHtml(substitution) : substitution;
    return message.replaceAll(`$${index + 1}`, value);
  }, template);
}

function applyNamedPlaceholders(
  template: string,
  placeholders: Readonly<Record<string, I18nPlaceholder>> | undefined,
  substitutions: readonly string[] | undefined,
  escapeValue: boolean,
): string {
  if (!placeholders || !substitutions) return template;
  return Object.entries(placeholders).reduce((message, [name, placeholder], index) => {
    const substitution = substitutions[index];
    if (substitution === undefined) return message;
    const value = escapeValue ? escapeHtml(substitution) : substitution;
    const token = placeholder.content.startsWith('$')
      ? placeholder.content
      : `$${name.toUpperCase()}$`;
    return message.replaceAll(token, value);
  }, template);
}

function readNavigatorLanguage(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.language;
}

function getActiveCatalogLocale(): 'ru' | 'en' {
  if (uiLanguageOverride !== undefined) {
    return resolveCatalogLanguage(uiLanguageOverride);
  }
  return DEFAULT_UI_LANGUAGE;
}

function getMessage(
  messageName: string,
  substitutions?: string | readonly string[],
  options?: GetMessageOptions,
): string {
  const catalog = catalogs[getActiveCatalogLocale()];
  const entry = catalog[messageName];
  if (!entry) return '';

  const values = substitutionList(substitutions);
  const escapeValue = options?.escapeValue ?? false;
  let message = entry.message;
  message = applyNamedPlaceholders(message, entry.placeholders, values, escapeValue);
  message = applySubstitutions(message, values, escapeValue);
  return message;
}

function getUILanguage(): string {
  if (uiLanguageOverride !== undefined) return uiLanguageOverride;
  return readNavigatorLanguage() ?? DEFAULT_UI_LANGUAGE;
}

function detectLanguage(text: string): readonly DetectedLanguage[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const cyrillicCount = (trimmed.match(/[\u0400-\u04FF]/g) ?? []).length;
  const latinCount = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const total = cyrillicCount + latinCount;
  if (total === 0) {
    return [{ language: resolveCatalogLanguage(getUILanguage()), percentage: 100 }];
  }

  const languages: DetectedLanguage[] = [];
  if (cyrillicCount > 0) {
    languages.push({ language: 'ru', percentage: Math.round((cyrillicCount / total) * 100) });
  }
  if (latinCount > 0) {
    languages.push({ language: 'en', percentage: Math.round((latinCount / total) * 100) });
  }
  return languages;
}

export const browserI18n: BrowserI18n = {
  getMessage,
  getUILanguage,
  detectLanguage,
};

/** WebExtensions-compatible `browser.i18n` surface for the MiniMed app shell. */
export const browser = {
  i18n: browserI18n,
};

export function setUILanguageForTests(language: string | undefined): void {
  uiLanguageOverride = language;
}
