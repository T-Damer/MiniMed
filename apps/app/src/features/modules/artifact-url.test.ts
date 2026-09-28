import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => platform.native },
}));

import { resolveContentModuleArtifactUrl } from '@/features/modules/artifact-url';
import { APP_PREFERENCES_KEY } from '@/state/app-preferences';

describe('resolveContentModuleArtifactUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    platform.native = false;
  });
  it('reads terminology and definition-reference releases from the Pages release mirror', () => {
    vi.stubGlobal('window', { location: { href: 'https://t-damer.github.io/MiniMed/app/' } });
    vi.stubEnv('BASE_URL', './');
    for (const [tag, file] of [
      ['terminology-ru-2026.9.16', 'minimed.terminology.ruwiktionary.index.db.gz'],
      ['definition-reference-2026.9.27', 'minimed.definition.reference.2026.9.27.db.gz'],
      [
        'reference-krasotaimedicina-2026.9.28',
        'minimed.reference.krasotaimedicina.2026.9.28.db.gz',
      ],
    ] as const) {
      const release = `https://github.com/T-Damer/MiniMed/releases/download/${tag}/${file}`;
      expect(resolveContentModuleArtifactUrl(release)).toBe(
        `https://t-damer.github.io/MiniMed/app/content/releases/${tag}/${file}`,
      );
      platform.native = true;
      vi.stubGlobal('window', { location: { href: 'https://localhost/' } });
      expect(resolveContentModuleArtifactUrl(release)).toBe(
        `https://t-damer.github.io/MiniMed/app/content/releases/${tag}/${file}`,
      );
      platform.native = false;
      vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:5173/' } });
      expect(resolveContentModuleArtifactUrl(release)).toBe(
        `http://127.0.0.1:5173/content/releases/${tag}/${file}`,
      );
      vi.stubGlobal('window', { location: { href: 'https://t-damer.github.io/MiniMed/app/' } });
    }
  });
  it('switches DEV downloads between local files and GitHub, ignoring the preference in production', () => {
    let local = true;
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5173/' },
      localStorage: {
        getItem: (key: string) =>
          key === APP_PREFERENCES_KEY
            ? JSON.stringify({ devLocalModuleArtifacts: local, moduleAutoUpdatesEnabled: true })
            : null,
      },
    });
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_USE_LOCAL_MODULE_ARTIFACTS', 'false');
    const remote =
      'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/public/content/modules/tools.db';
    expect(resolveContentModuleArtifactUrl(remote)).toBe(
      'http://127.0.0.1:5173/content/modules/tools.db',
    );
    local = false;
    expect(resolveContentModuleArtifactUrl(remote)).toBe(remote);
    local = true;
    vi.stubEnv('DEV', false);
    expect(resolveContentModuleArtifactUrl(remote)).toBe(remote);
  });
  it('uses the remote clinical artifact in a default native WebView build', () => {
    vi.stubGlobal('window', { location: { href: 'https://localhost/' } });
    expect(
      resolveContentModuleArtifactUrl(
        'https://github.com/T-Damer/MiniMed/releases/download/clinical-test/clinical-1.db',
      ),
    ).toBe(
      'https://raw.githubusercontent.com/T-Damer/MiniMed/datasets/clinical-test/apps/app/public/content/clinical/clinical-1.db',
    );
  });
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

  it('uses the CORS-safe LFS media mirror for large ESKLP packages', () => {
    expect(
      resolveContentModuleArtifactUrl(
        'https://github.com/T-Damer/MiniMed/releases/download/esklp-2026-08-28/minimed.medications.antiparasitic.ru.db',
      ),
    ).toBe(
      'https://media.githubusercontent.com/media/T-Damer/MiniMed/datasets/esklp-2026-08-28/modules/minimed.medications.antiparasitic.ru.db',
    );
  });

  it('keeps unrelated hosts unchanged', () => {
    const url = 'https://example.test/module.db';
    expect(resolveContentModuleArtifactUrl(url)).toBe(url);
  });

  it('keeps compressed clinical and ESKLP downloads on their dataset mirrors', () => {
    vi.stubEnv('VITE_USE_LOCAL_MODULE_ARTIFACTS', 'false');
    expect(
      resolveContentModuleArtifactUrl(
        'https://github.com/T-Damer/MiniMed/releases/download/clinical-test/clinical-1.db.gz',
      ),
    ).toBe(
      'https://raw.githubusercontent.com/T-Damer/MiniMed/datasets/clinical-test/apps/app/public/content/clinical/clinical-1.db.gz',
    );
    expect(
      resolveContentModuleArtifactUrl(
        'https://github.com/T-Damer/MiniMed/releases/download/esklp-test/minimed.medications.test.ru.db.gz',
      ),
    ).toBe(
      'https://media.githubusercontent.com/media/T-Damer/MiniMed/datasets/esklp-test/modules/minimed.medications.test.ru.db.gz',
    );
  });
});
