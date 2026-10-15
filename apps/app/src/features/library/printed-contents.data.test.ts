import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMedicalCore } from '@localmed/core';
import { MultiMedicalStore } from '@localmed/storage';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';
import { describe, expect, it } from 'vitest';

import { visibleReaderSections } from './document-display';
import { isContentsLine, splitPrintedContents } from './printed-contents';

// The shipped «Педиатрия: дыхание и аллергология» module (committed under public/content/modules)
// keeps the printed contents of the PDF as the first 29 sections of «Внебольничная пневмония у
// детей» (QA 0.6.60: the reader opened on «Оглавление Список сокращений ……… 4»).
const DATABASE = resolve(
  import.meta.dirname,
  '../../../public/content/modules/minimed-respiratory-pediatrics-full-0.3.4-preview.1.db',
);

describe('printed contents of a shipped guideline module', () => {
  it('splits the leading contents off all three documents and leaves text in the body', async () => {
    const store = await SqliteMedicalStore.createFromBytes(new Uint8Array(readFileSync(DATABASE)));
    const core = createMedicalCore({
      store: new MultiMedicalStore([{ moduleId: 'respiratory', store, searchWeight: 1 }]),
      platform: 'test',
    });
    await core.initialize();

    for (const id of [
      'kr.rf.714_2.pneumonia.full',
      'kr.rf.360_3.bronchiolitis.full',
      'kr.rf.381_3.bronchitis.full',
    ]) {
      const opened = await core.getDocument(id);
      if (!opened.ok) throw new Error(opened.error.message);
      const sections = visibleReaderSections(opened.value.sections, opened.value.sourceType);
      const split = splitPrintedContents(sections);

      expect(split.sections.length, id).toBeGreaterThan(id.includes('714_2') ? 5 : 0);
      // Nothing is lost: all the text of the document is in one of the two parts (a chunk that
      // starts with a title page is cut into the two).
      const textOf = (list: typeof sections): string =>
        list
          .flatMap((section) => section.chunks.map((chunk) => chunk.originalText))
          .join('')
          .replace(/\s+/gu, '');
      expect(textOf(split.sections).length + textOf(split.body).length, id).toBe(
        textOf(sections).length,
      );
      // The page starts on the document's own text.
      const first = split.body[0];
      expect(first, id).toBeDefined();
      expect(isContentsLine(first?.title ?? ''), id).toBe(false);
      expect(split.body.filter((section) => isContentsLine(section.title)).length, id).toBe(0);
    }
    await core.close();
  });
});
