// The bundled regulatory.db is a light pack (323-ФЗ in full text + a pointer card per other act); the
// full texts are the downloadable module `minimed.regulatory.pediatrics.ru`. These checks tie the two
// together: every card must resolve, by exact membership, to the released module that replaces it.
import { DatabaseSync } from 'node:sqlite';

import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { resolveContentModuleArtifactUrl } from '@/features/modules/artifact-url';
import catalogJson from '@/features/modules/catalog.preview.json';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import {
  parseModulePointerMetadata,
  resolveModulePointer,
} from '@/features/modules/module-pointer-install';

const MODULE_ID = 'minimed.regulatory.pediatrics.ru';
const MAIN_LAW_ID = 'regulatory.rf.federal-law.323-fz-2011';
const BUNDLED = 'apps/app/public/content/regulatory.db';
/** sqlite-wasm reads the bundled pack into memory at every start: the full texts were 27.8 MB. */
const BUNDLED_MAX_BYTES = 5 * 1024 * 1024;

const catalog = ContentModuleCatalogSchema.parse(catalogJson);
const entry = catalog.modules.find((module) => module.id === MODULE_ID);

interface BundledDocument {
  readonly id: string;
  readonly version: string;
  readonly metadata: Record<string, unknown>;
}

function bundledDocuments(): readonly BundledDocument[] {
  const database = new DatabaseSync(BUNDLED, { readOnly: true });
  try {
    return (
      database
        .prepare(
          'SELECT d.id AS id, d.current_version_id AS version, d.metadata_json AS metadata ' +
            'FROM documents d ORDER BY d.id',
        )
        .all() as { id: string; version: string; metadata: string }[]
    ).map((row) => ({
      id: row.id,
      version: row.version,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    }));
  } finally {
    database.close();
  }
}

describe('the regulatory full-text module in the catalog', () => {
  it('is a released zstd index on its own dataset branch, for the next app', () => {
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.kind).toBe('regulatory');
    expect(entry.releaseState).toBe('published');
    expect(entry.compatibility.minAppVersion).toBe('0.6.60');
    expect(isModuleReleased(entry)).toBe(true);
    const [index, ...others] = entry.artifacts;
    expect(others).toEqual([]);
    expect(index?.compression).toBe('zstd');
    expect(index?.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(index?.decodedSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(entry.sizes.downloadBytes).toBe(index?.sizeBytes);
    // Shown on the download offer: well below the 27.8 MB it was when it was bundled.
    expect(index?.sizeBytes).toBeLessThan(5 * 1024 * 1024);
    expect(index?.url).toMatch(
      /\/releases\/download\/(regulatory-[\w.-]+)\/minimed\.regulatory\.pediatrics\.[\w.-]+\.db\.zst$/u,
    );
    const resolved = resolveContentModuleArtifactUrl(index?.url ?? '');
    expect(resolved).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/T-Damer\/MiniMed\/datasets\/regulatory-[\w.-]+\/modules\/minimed\.regulatory\.pediatrics\.[\w.-]+\.db\.zst$/u,
    );
  });
});

describe('the bundled regulatory pack', () => {
  const documents = bundledDocuments();

  it('is small enough to be read into memory at every start', () => {
    const database = new DatabaseSync(BUNDLED, { readOnly: true });
    try {
      const pages = database.prepare('PRAGMA page_count').get() as { page_count: number };
      const size = database.prepare('PRAGMA page_size').get() as { page_size: number };
      expect(pages.page_count * size.page_size).toBeLessThan(BUNDLED_MAX_BYTES);
    } finally {
      database.close();
    }
  });

  it('holds exactly the documents of the module, under the same ids and versions', () => {
    expect(entry).toBeDefined();
    const members = new Map(
      (entry?.documents ?? []).map((document) => [document.documentId, document]),
    );
    expect(documents.map((document) => document.id).sort()).toEqual([...members.keys()].sort());
    for (const document of documents) {
      expect(members.get(document.id)?.documentVersionId, document.id).toBe(document.version);
    }
  });

  it('keeps 323-ФЗ as full text and makes every other act a card for the module', () => {
    const law = documents.find((document) => document.id === MAIN_LAW_ID);
    expect(law?.metadata['contentMode']).toBe('source_text');
    expect(parseModulePointerMetadata(law?.metadata)).toBeNull();
    const database = new DatabaseSync(BUNDLED, { readOnly: true });
    try {
      const sections = database
        .prepare(
          'SELECT count(*) AS count FROM sections s JOIN document_versions v ' +
            'ON v.id = s.document_version_id WHERE v.document_id = ?',
        )
        .get(MAIN_LAW_ID) as { count: number };
      expect(sections.count).toBeGreaterThan(100);
    } finally {
      database.close();
    }
    const cards = documents.filter((document) => document.id !== MAIN_LAW_ID);
    const pointers = cards.filter(
      (document) => parseModulePointerMetadata(document.metadata) !== null,
    );
    // The status crosswalk is small prose and stays whole; every act is a pointer.
    expect(cards.length - pointers.length).toBe(1);
    expect(pointers).toHaveLength(29);
  });

  it('offers the module for every card, through exact membership of its verified index', () => {
    for (const document of documents) {
      const pointer = parseModulePointerMetadata(document.metadata);
      if (!pointer) continue;
      // The card is replaced by the document of the same id once the module is installed.
      expect(pointer.targetDocumentId, document.id).toBe(document.id);
      const resolution = resolveModulePointer(pointer, catalog, []);
      expect(resolution.state, document.id).toBe('available');
      expect(resolution.module?.id, document.id).toBe(MODULE_ID);
    }
  });
});
