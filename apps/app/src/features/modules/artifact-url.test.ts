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

  it('keeps clinical snapshot release assets on the published release', () => {
    const url =
      'https://github.com/T-Damer/MiniMed/releases/download/clinical-2026.07.24-cbb0e01c1bce/clinical-714_2-clinical-2026.07.24-cbb0e01c1bce.db';
    expect(resolveContentModuleArtifactUrl(url)).toBe(url);
  });

  it('keeps unrelated hosts unchanged', () => {
    const url = 'https://example.test/module.db';
    expect(resolveContentModuleArtifactUrl(url)).toBe(url);
  });
});
