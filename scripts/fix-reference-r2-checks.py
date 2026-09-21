"""Temporary fixes for observed R2 integration gates; removed after delivery."""
import json
from pathlib import Path

changed = json.loads(Path('data/build/reference-r2-changed.json').read_text())
def edit(name, pairs):
    path = Path(name)
    text = path.read_text()
    for before, after in pairs:
        if text.count(before) != 1:
            raise ValueError('Fix anchor changed: ' + name + ': ' + before[:100])
        text = text.replace(before, after)
    path.write_text(text)
    if name not in changed:
        changed.append(name)

edit('apps/app/src/features/setup/FirstRunSetup.tsx', [
    ('class="package-row__asterisk" aria-label="Обязательный пакет"', 'class="package-row__asterisk" aria-hidden="true"'),
])
edit('packages/storage/tests/reference-mount.test.ts', [
    ('const count = vi.mocked(reference.reference!).mock.calls.length;', "const read = reference.reference;\n    if (!read) throw new Error('Missing fixture reference capability.');\n    const count = vi.mocked(read).mock.calls.length;"),
    ('vi.mocked(reference.reference!).mock.calls', 'vi.mocked(read).mock.calls'),
])
edit('apps/app/src/composition/worker-opfs-medical-store.ts', [
    ('{ ...options, waitForDownloadApproval: Boolean(downloadUi) }', '{ ...options, ...(downloadUi ? { waitForDownloadApproval: true } : {}) }'),
])
edit('apps/app/src/composition/create-browser-core.ts', [
    ("  const descriptor = { id: `core:web:${databaseName}`", "  if (!downloadUi) return WorkerOpfsMedicalStore.open({ url, databaseName, fetchTimeoutMs: OPFS_PACK_FETCH_TIMEOUT_MS, poolName: 'minimed-sah-core' });\n  const descriptor = { id: `core:web:${databaseName}`"),
])
# A generated local development edition must not be copied into a production distribution.
edit('apps/app/vite.config.ts', [
    ("      // Illustrations are verified optional downloads; keep their small manifest in the app.", "      // The unreviewed local reference is installed explicitly in DEV, never bundled for release.\n      rmSync(join(outDir, 'content/definition-reference'), { recursive: true, force: true });\n      // Illustrations are verified optional downloads; keep their small manifest in the app."),
])
changed.append('packages/storage-sqlite/src/generated/schema.ts')
Path('data/build/reference-r2-changed.json').write_text(json.dumps(list(dict.fromkeys(changed))))
