import { describe, expect, it } from 'vitest';

import { resolveContentModuleArtifactUrl } from './artifact-url';

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

  it('rewrites clinical snapshot release assets to the matching raw git tag', () => {
    expect(
      resolveContentModuleArtifactUrl(
        'https://github.com/T-Damer/MiniMed/releases/download/clinical-2026.07.24-cbb0e01c1bce/clinical-714_2-clinical-2026.07.24-cbb0e01c1bce.db',
      ),
    ).toBe(
      'https://raw.githubusercontent.com/T-Damer/MiniMed/clinical-2026.07.24-cbb0e01c1bce/apps/app/public/content/clinical/clinical-714_2-clinical-2026.07.24-cbb0e01c1bce.db',
    );
  });

  it('keeps unrelated hosts unchanged', () => {
    const url = 'https://example.test/module.db';
    expect(resolveContentModuleArtifactUrl(url)).toBe(url);
  });
});
