// Data-type tests for the JSON assets that ship with the app (lazy chunks, indexes, manifests).
// Each type gets integrity checks (shape, unique ids, references that resolve, files that exist,
// checksums that match) and one representative assertion, never one test per item.
// The table of types, sources and sibling tests is docs/DATA_TESTS.md.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseComparisonIndex } from '@/features/drug-comparison/comparison-index';
import comparisonIndexJson from '@/features/drug-comparison/data/comparison-index.json';
import interactionIndexJson from '@/features/drug-interactions/data/interaction-index.json';
import { parseInteractionIndex } from '@/features/drug-interactions/interaction-index';
import safetyIndexJson from '@/features/medication-safety/data/safety-index.json';
import { parseSafetyIndex } from '@/features/medication-safety/safety-index';
import catalog from '@/features/modules/catalog.preview.json';

const PUBLIC = 'apps/app/public';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface IndexBasis {
  readonly basis: {
    readonly modules: readonly {
      readonly id: string;
      readonly version: string;
      readonly sha256: string;
    }[];
  };
}

describe('drug instruction indexes (interactions, safety, comparison)', () => {
  const indexes = {
    interactions: interactionIndexJson as unknown as IndexBasis,
    safety: safetyIndexJson as unknown as IndexBasis,
    comparison: comparisonIndexJson as unknown as IndexBasis,
  };

  it('parse with their own validators, which reject references outside the tables', () => {
    expect(() => parseInteractionIndex(interactionIndexJson)).not.toThrow();
    expect(() => parseSafetyIndex(safetyIndexJson)).not.toThrow();
    expect(() => parseComparisonIndex(comparisonIndexJson)).not.toThrow();
  });

  it('were built from the same instruction modules, all of which the catalog still lists', () => {
    const catalogIds = new Set(catalog.modules.map((module) => module.id));
    const idsOf = (index: IndexBasis) => index.basis.modules.map((module) => module.id).sort();
    expect(idsOf(indexes.safety)).toEqual(idsOf(indexes.interactions));
    expect(idsOf(indexes.comparison)).toEqual(idsOf(indexes.interactions));
    expect(indexes.interactions.basis.modules.length).toBeGreaterThanOrEqual(10);
    for (const module of indexes.interactions.basis.modules) {
      expect(catalogIds.has(module.id), module.id).toBe(true);
    }
  });

  // DEFECT (docs/DATA_TESTS.md): the three indexes record the `…e5` builds of the GRLS instruction modules,
  // the catalog ships the `…kd1` builds since 2026-10-11. Section checksums inside the indexes keep working only
  // if the instruction text did not change. Remove `.fails` when the indexes are rebuilt from the shipped modules.
  it.fails('record the exact module versions and checksums the catalog ships', () => {
    for (const index of Object.values(indexes)) {
      for (const basis of index.basis.modules) {
        const module = catalog.modules.find((candidate) => candidate.id === basis.id);
        expect(module?.version, basis.id).toBe(basis.version);
        const artifact = module?.artifacts.find((candidate) => candidate.kind === 'index') as
          | { sha256?: string; decodedSha256?: string }
          | undefined;
        expect([artifact?.sha256, artifact?.decodedSha256], basis.id).toContain(basis.sha256);
      }
    }
  });
});

describe('symptom expressions (search-lexical lazy JSON)', () => {
  interface Entry {
    readonly id: string;
    readonly canonical: string;
    readonly label: string;
    readonly system: string;
    readonly phrases: readonly string[];
  }
  const data = readJson<{ version: string; language: string; entries: readonly Entry[] }>(
    'packages/search-lexical/src/symptom-expressions.ru.json',
  );

  it('has unique ids, non-empty normalized phrases and no phrase shared by two symptoms', () => {
    expect(data.language).toBe('ru');
    expect(data.entries.length).toBeGreaterThan(20);
    const ids = new Set<string>();
    const phrases = new Map<string, string>();
    for (const entry of data.entries) {
      expect(entry.id).toMatch(/^symptom\.[a-z0-9_.-]+$/);
      expect(ids.has(entry.id), `duplicate ${entry.id}`).toBe(false);
      ids.add(entry.id);
      expect(entry.canonical.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.label.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.phrases.length, entry.id).toBeGreaterThan(0);
      for (const phrase of entry.phrases) {
        expect(phrase, entry.id).toBe(phrase.trim().toLocaleLowerCase('ru-RU'));
        expect(phrases.get(phrase), `${phrase} shared by ${entry.id}`).toBeUndefined();
        phrases.set(phrase, entry.id);
      }
    }
    expect(phrases.get('хрипы')).toBe('symptom.rales');
  });
});

describe('onboarding MRI viewer slices', () => {
  const dir = join(PUBLIC, 'onboarding/mri-viewer');
  const manifest = readJson<{
    slices: readonly string[];
    source: { title: string; url: string; license: string; licenseUrl: string };
  }>(join(dir, 'manifest.json'));

  it('lists existing, non-empty slice files and names the source and its licence', () => {
    expect(manifest.slices.length).toBeGreaterThanOrEqual(3);
    expect(new Set(manifest.slices).size).toBe(manifest.slices.length);
    for (const slice of manifest.slices) {
      expect(statSync(join(dir, slice)).size, slice).toBeGreaterThan(1000);
    }
    expect(manifest.source.url).toMatch(/^https:\/\//);
    expect(manifest.source.licenseUrl).toMatch(/^https:\/\//);
    expect(manifest.source.license.length).toBeGreaterThan(0);
  });
});

describe('reference images (krasotaimedicina illustrations)', () => {
  interface Image {
    readonly alt: string;
    readonly contentType: string;
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
    readonly sourceUrl: string;
  }
  const previewDir = join(PUBLIC, 'content/reference-images-preview');

  it('keeps every preview image on disk with the size and SHA-256 its index records', () => {
    const index = readJson<{
      schemaVersion: number;
      images: readonly (Image & { documentId: string })[];
    }>(join(previewDir, 'index.json'));
    expect(index.schemaVersion).toBe(1);
    expect(index.images.length).toBeGreaterThan(0);
    for (const image of index.images) {
      const bytes = readFileSync(join(previewDir, image.path));
      expect(bytes.length, image.path).toBe(image.size);
      expect(`sha256:${sha256(bytes)}`, image.path).toBe(image.sha256);
      expect(image.path, 'content-addressed file name').toContain(sha256(bytes));
      expect(image.documentId).toMatch(/^krasotaimedicina\.disease\./);
    }
  });

  it('has a full manifest whose totals equal its entries and whose failures are a small, recorded minority', () => {
    const manifest = readJson<{
      schemaVersion: number;
      documentCount: number;
      imageCount: number;
      totalBytes: number;
      images: Record<string, readonly Image[]>;
      failures: Record<string, unknown>;
    }>(join(PUBLIC, 'content/reference-images/manifest.json'));
    expect(manifest.schemaVersion).toBe(1);
    const lists = Object.values(manifest.images);
    expect(lists.length).toBe(manifest.documentCount);
    const all = lists.flat();
    expect(all.length).toBe(manifest.imageCount);
    expect(all.reduce((sum, image) => sum + image.size, 0)).toBe(manifest.totalBytes);
    for (const image of all) {
      expect(image.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(image.path).toBe(
        `assets/${image.sha256.slice('sha256:'.length)}.${image.path.split('.').pop()}`,
      );
      expect(image.size).toBeGreaterThan(0);
    }
    expect(Object.keys(manifest.failures).length).toBeLessThan(manifest.documentCount * 0.01);
    for (const documentId of Object.keys(manifest.failures)) {
      expect(documentId in manifest.images, `${documentId} failed and is also listed`).toBe(false);
    }
  });

  it('records the checksum of the packed reference-images archive', () => {
    const line = readFileSync('content/bundled/reference-images.sha256', 'utf8').trim();
    expect(line).toMatch(/^[0-9a-f]{64} {2}reference-images\.tar\.gz$/);
  });
});

describe('landing page snapshots', () => {
  interface Tool {
    readonly id: string;
    readonly definition?: unknown;
  }
  const authored = (file: string): Tool[] =>
    readJson<{ tools: Tool[] }>(`content/tool-modules/${file}.json`).tools;

  // DEFECT (docs/DATA_TESTS.md): apps/landing/src/data/{calculator,questionnaire}.json are older than the authored
  // definitions (no `ageScope`, `audience` still present). Refresh them from content/tool-modules and drop `.fails`.
  it.fails('keep the shown calculator and questionnaire equal to their authored definitions', () => {
    const calculator = readJson<{ id: string }>('apps/landing/src/data/calculator.json');
    const questionnaire = readJson<{ id: string }>('apps/landing/src/data/questionnaire.json');
    const sources = [...authored('core-clinical'), ...authored('obstetrics-gynecology')];
    const calculatorSource = sources.find((tool) => tool.id === calculator.id);
    const questionnaireSource = sources.find((tool) => tool.id === questionnaire.id);
    expect(calculatorSource?.definition).toEqual(calculator);
    expect(questionnaireSource?.definition).toEqual(questionnaire);
  });

  it('keep the three search cards with their source anchors and checksums', () => {
    const cards = readJson<{
      databaseChecksum: string;
      cards: readonly {
        id: string;
        sourceChecksum: string;
        chunks: readonly { anchor: string; text: string }[];
      }[];
    }>('apps/landing/src/data/searchCards.json');
    expect(cards.databaseChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(cards.cards).toHaveLength(3);
    for (const card of cards.cards) {
      expect(card.sourceChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(card.chunks.length).toBeGreaterThan(0);
      for (const chunk of card.chunks) {
        expect(chunk.anchor.startsWith(`${card.id}@`), chunk.anchor).toBe(true);
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('public static assets exist where the app and the service worker expect them', () => {
  it('ships the manifest, icons and the worker', () => {
    for (const file of [
      'manifest.webmanifest',
      'sw.js',
      'icon-192.png',
      'icon-512.png',
      'favicon.ico',
    ]) {
      expect(existsSync(join(PUBLIC, file)), file).toBe(true);
    }
    const manifest = readJson<{ name: string; icons: readonly { src: string }[] }>(
      join(PUBLIC, 'manifest.webmanifest'),
    );
    expect(manifest.name.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(existsSync(join(PUBLIC, icon.src.replace(/^\.?\//, ''))), icon.src).toBe(true);
    }
  });
});
