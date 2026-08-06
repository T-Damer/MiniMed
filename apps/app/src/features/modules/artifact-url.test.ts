import { describe, expect, it } from 'vitest';

import { resolveContentModuleArtifactUrl } from '@/features/modules/artifact-url';

describe('resolveContentModuleArtifactUrl', () => {
  it('rewrites MiniMed specialty release assets to raw.githubusercontent.com on main', () => {
    expect(
      resolveContentModuleArtifactUrl(
        'https://github.com/T-Damer/MiniMed/releases/download/datasets-preview-1/minimed-regulatory-pediatrics-0.3.4-preview.1.db',
      ),
    ).toBe(
      'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/public/content/modules/minimed-regulatory-pediatrics-0.3.4-preview.1.db',
    );
  });

  it('rewrites clinical snapshot release assets to the CORS-safe datasets mirror branch', () => {
    const url =
      'https://github.com/T-Damer/MiniMed/releases/download/clinical-json-2026.07.27-13991c1feee5/clinical-714_2-clinical-json-2026.07.27-13991c1feee5.db';
    expect(resolveContentModuleArtifactUrl(url)).toBe(
      'https://raw.githubusercontent.com/T-Damer/MiniMed/datasets/clinical-json-2026.07.27-13991c1feee5/apps/app/public/content/clinical/clinical-714_2-clinical-json-2026.07.27-13991c1feee5.db',
    );
  });

  it('keeps unrelated hosts unchanged', () => {
    const url = 'https://example.test/module.db';
    expect(resolveContentModuleArtifactUrl(url)).toBe(url);
  });
});
