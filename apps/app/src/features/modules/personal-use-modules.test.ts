import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import previewCatalog from '@/features/modules/catalog.preview.json';
import shellCatalog from '@/features/modules/catalog.shell.json';

// Personal-use modules (Vidal, the Citilab lab compilation, TNM, Pevzner diets from the
// MedElement app) are built into the git-ignored output/local-modules/ and installed from a file.
// The repository is public: none of them may appear in a shipped catalog or public asset.
const PERSONAL_ID = /minimed[.-]local[.-]/u;
const PERSONAL_RIGHTS = 'personal-use-only';

const publicModulesDir = join(__dirname, '../../../public/content/modules');

describe('personal-use modules stay out of public artifacts', () => {
  it('no catalog entry names a personal-use module', () => {
    expect(JSON.stringify(previewCatalog)).not.toMatch(PERSONAL_ID);
    expect(JSON.stringify(shellCatalog)).not.toMatch(PERSONAL_ID);
  });

  it('no file under public/content/modules is a personal-use module', () => {
    const names = readdirSync(publicModulesDir, { recursive: true }).map(String);
    expect(names.filter((name) => PERSONAL_ID.test(name))).toEqual([]);
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
      expect(readFileSync(join(publicModulesDir, name), 'utf8')).not.toContain(PERSONAL_RIGHTS);
    }
  });
});
