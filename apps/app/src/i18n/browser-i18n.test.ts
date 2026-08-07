import { describe, expect, it } from 'vitest';

import { browserI18n, setUILanguageForTests } from '@/i18n/browser-i18n';
import {
  collectionLabel,
  documentCountLabel,
  recommendationCountLabel,
  specialtyLabel,
  specialtyMessageKey,
} from '@/i18n/labels';

describe('browser-i18n', () => {
  it('loads Russian specialty messages by default', () => {
    expect(browserI18n.getMessage('specialty_pediatrics')).toBe('Педиатрия');
    expect(browserI18n.getMessage('specialty_pulmonology')).toBe('Пульмонология');
    expect(browserI18n.getMessage('specialty_clinical_pharmacology')).toBe(
      'Клиническая фармакология',
    );
  });

  it('applies numeric substitutions in WebExtensions style', () => {
    expect(browserI18n.getMessage('recommendation_installed_partial', ['5', '37'])).toBe(
      'На устройстве: 5 из 37',
    );
    expect(browserI18n.getMessage('graph_document_count', '12')).toBe('12 документов');
  });

  it('returns an empty string for unknown message keys', () => {
    expect(browserI18n.getMessage('missing_message_key')).toBe('');
  });

  it('switches catalogs when the UI language is English', () => {
    setUILanguageForTests('en-US');
    expect(browserI18n.getMessage('specialty_pediatrics')).toBe('Pediatrics');
    expect(browserI18n.getMessage('collection_pediatrics')).toBe('Clinical pediatrics');
    setUILanguageForTests(undefined);
    expect(browserI18n.getMessage('specialty_pediatrics')).toBe('Педиатрия');
  });

  it('detects Cyrillic text as Russian', () => {
    expect(browserI18n.detectLanguage('Педиатрия')).toEqual([{ language: 'ru', percentage: 100 }]);
  });
});

describe('labels', () => {
  it('maps corpus specialty slugs to message keys', () => {
    expect(specialtyMessageKey('allergology-immunology')).toBe('specialty_allergology_immunology');
    expect(specialtyLabel('pediatrics')).toBe('Педиатрия');
    expect(specialtyLabel('unknown-specialty')).toBe('unknown-specialty');
  });

  it('formats recommendation counts with Russian plural rules', () => {
    expect(recommendationCountLabel(1)).toBe('1 клиническая рекомендация');
    expect(recommendationCountLabel(3)).toBe('3 клинические рекомендации');
    expect(recommendationCountLabel(37)).toBe('37 клинических рекомендаций');
  });

  it('formats document counts with Russian plural rules', () => {
    expect(documentCountLabel(1)).toBe('1 документ');
    expect(documentCountLabel(2)).toBe('2 документа');
    expect(documentCountLabel(15)).toBe('15 документов');
  });

  it('localizes module collection ids', () => {
    expect(collectionLabel('pediatrics')).toBe('Клиническая педиатрия');
    expect(collectionLabel('unknown')).toBe('unknown');
  });
});
