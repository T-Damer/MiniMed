"""Temporary scoped R2 integration runner; no credentials, downloads of models or publication."""
import ast
import json
import re
import subprocess
from pathlib import Path

p = Path('scripts/apply-reference-r2-integration.py')
tree = ast.parse(p.read_text())
for node in ast.walk(tree):
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name) or node.func.id != 'edit':
        continue
    if node.args[0].value == 'apps/app/src/features/search/WorkerSearchMedicalCore.ts':
        pair = node.args[1].elts[0]
        pair.elts[0].value = 'import type {\n  AnalyzeQueryRequest,'
        pair.elts[1].value += '\n  AnalyzeQueryRequest,'
    if node.args[0].value == 'apps/app/src/features/modules/browser-module-runtime.ts':
        pair = node.args[1].elts[-1]
        pair.elts[1].value = pair.elts[1].value.replace(
            'if (stored.definitionReference) {',
            'if (stored.definitionReference) {\n          await store.initialize();', 1,
        )
p.write_text(ast.unparse(tree) + '\n')
subprocess.run(['python3', str(p)], check=True)
subprocess.run(['python3', 'scripts/apply-browser-core-approval.py'], check=True)
paths = json.loads(Path('data/build/reference-r2-changed.json').read_text())

p = Path('apps/app/src/features/search/UnifiedSearchCatalog.tsx')
s = p.read_text().replace("import { DefinitionDraftMatches } from '@/features/search/DefinitionDraftMatches';\n", '')
s, count = re.subn(r'      <Show\n        when=\{\n          import.meta.env.DEV.*?<DefinitionDraftMatches query=\{props.query\} />\n      </Show>\n', '', s, count=1, flags=re.S)
assert count == 1, 'Legacy reference preview anchor changed'
p.write_text(s)
paths.append(str(p))

p = Path('apps/app/src/features/modules/browser-module-runtime.ts')
s = p.read_text()
if 'public getCatalog(' not in s:
    anchor = '  public listInstalled()'
    assert s.count(anchor) == 1
    s = s.replace(anchor, '  public getCatalog(): ContentModuleCatalog { return this.catalog; }\n\n' + anchor)
p.write_text(s)
p = Path('apps/app/src/features/setup/FirstRunSetup.tsx')
s = p.read_text().replace('createMemo(() => { revision(); return setupPackageGroups(runtime.getCatalog().modules); })', 'createMemo(() => setupPackageGroups(runtime.getCatalog().modules))')
p.write_text(s)

# The owner explicitly requested optional selection, not automatic installation of all published tools.
p = Path('apps/app/src/features/modules/local-packaged-modules.test.ts')
s = p.read_text().replace('selects published tool packs that are not already installed', 'does not select uninstalled optional tool packs without a user action')
old = "expect(localPackagedModulesToInstall(catalog, new Map()).map((entry) => entry.id)).toEqual([\n      'minimed.tools.psychology.ru',\n    ]);"
assert s.count(old) == 1
s = s.replace(old, 'expect(localPackagedModulesToInstall(catalog, new Map()).map((entry) => entry.id)).toEqual([]);')
p.write_text(s)
paths.append(str(p))
Path('data/build/reference-r2-changed.json').write_text(json.dumps(paths))
subprocess.run(['python3', 'scripts/fix-reference-r2-checks.py'], check=True)
subprocess.run(['bun', 'run', 'schema:generate'], check=True)
paths = json.loads(Path('data/build/reference-r2-changed.json').read_text())
paths += ['packages/contracts/src/definition-reference-api.ts', 'packages/storage-sqlite/src/definition-reference-dispatch.ts', 'packages/storage/tests/reference-mount.test.ts', 'apps/app/src/features/modules/local-definition-reference.ts']
for folder in ['apps/app/src/features/setup', 'apps/app/src/features/reference']:
    paths += [str(p) for p in Path(folder).glob('*') if p.suffix in ['.ts', '.tsx', '.css']]
paths = list(dict.fromkeys(paths))
Path('data/build/reference-r2-code-paths.json').write_text(json.dumps(paths))
format_paths = [p for p in paths if Path(p).suffix in ['.ts', '.tsx', '.css'] and '/generated/' not in p]
commands = [
    ['bunx', 'biome', 'check', '--write', '--diagnostic-level=error', '--max-diagnostics=100', *format_paths],
    ['bun', 'run', 'schema:check'],
    ['bunx', 'tsc', '--noEmit', '-p', 'packages/storage-sqlite/tsconfig.json'],
    ['bunx', 'tsc', '--noEmit', '-p', 'packages/core/tsconfig.json'],
    ['bunx', 'tsc', '--noEmit', '-p', 'apps/app/tsconfig.json'],
    ['python3', '-m', 'py_compile', 'scripts/prepare-definition-reference.py'],
    ['uv', 'run', '--project', 'tools/ingest', 'pytest', '-q', 'tools/ingest/tests/test_definition_reference_pack.py', 'tools/ingest/tests/test_definition_reference_compact.py', 'tools/ingest/tests/test_definition_reference_metadata.py'],
    ['bunx', 'vitest', 'run', 'packages/storage/tests/reference-mount.test.ts', 'packages/storage-sqlite/tests/definition-reference-layout.test.ts', 'packages/storage-sqlite/tests/definition-reference-metadata.test.ts', 'apps/app/src/features/setup/setup-state.test.ts', 'apps/app/src/composition/worker-opfs-medical-store.test.ts', 'apps/app/src/composition/create-browser-core.test.ts', 'apps/app/src/features/modules/local-packaged-modules.test.ts', 'packages/core/tests/content-module-installer.test.ts'],
]
statuses = []
for command in commands:
    print('::group::' + ' '.join(command[:7]), flush=True)
    statuses.append(subprocess.run(command).returncode)
    print('::endgroup::', flush=True)
print('Gate exit codes:', statuses, flush=True)
if any(statuses):
    raise SystemExit(1)
