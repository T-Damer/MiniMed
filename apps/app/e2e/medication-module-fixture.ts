import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';
import { LOCAL_DATA_ROOT } from './local-data';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

/**
 * Since 0.6.47 the core holds only medication pointers, so medication cards exist once a medication
 * module is installed. These helpers install the smallest one (the antiparasitic ЕСКЛП group) from
 * its published bytes, kept as the local release copy (docs/data-ledger.json), and open a card.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
// The local release copies stay in the main checkout; an agent worktree (`<main>/.claude/worktrees/…`) reads them there.
const DATA_ROOT = LOCAL_DATA_ROOT;
export const MEDICATION_MODULE_ID = 'minimed.medications.antiparasitic.ru';
const PUBLISHED_DIRECTORY = 'output/module-zstd-esklp-str2-2026-10-20/esklp-2026-08-28-str2';
const POINTER = 'core.catalog.pointer.medication.esklp.mnn.албендазол-062d3e89c1c0b8dd';
export const INSTRUCTION_MODULE_ID = 'minimed.medications.instructions.antiparasitic.ru';
// The ГРЛС instruction modules as republished by FIX-BATCH2 (2026-11-06); the catalog pins their hashes.
const INSTRUCTION_DIRECTORY =
  'output/module-zstd-grls-fb2-2026-11-06/grls-instructions-2026.11.06-9a01334d2a42-kd1';

const documentRoute = (id: string) =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

/** Serves the module's published file; call before mounting. Skips when the copy is absent. */
export async function routeMedicationModule(page: Page): Promise<void> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules.find((module) => module.id === MEDICATION_MODULE_ID)
    ?.artifacts[0];
  if (!artifact?.url) throw new Error('Missing medication module artifact');
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath = resolve(DATA_ROOT, PUBLISHED_DIRECTORY, fileName);
  test.skip(!existsSync(localPath), `The published module file ${fileName} is local-only.`);
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
  );
  await routeCompanionModules(page, catalog);
}

/** The EAEU texts, one module for every drug group (ADR of 2026-10-26), as released locally. */
const EAEU_MODULE_ID = 'minimed.medications.instructions.eaeu-sister-register.ru';
const EAEU_DIRECTORY = 'output/module-zstd-eaeu-2026-10-26';
/** The companions each page serves from local copies, which `installMedicationModule` waits for. */
const servedCompanions = new WeakMap<Page, readonly string[]>();

/**
 * A drug group's module installs with its companions (the group's ГРЛС instructions and the EAEU
 * texts, `module-companions.ts`). Served from the network they landed at any moment of a test
 * (the 28 MB EAEU file finished 47 s after a card opened): the drug screen then switched to its
 * instruction and the core reloaded under the test, taking the header's focused «⋯» with it
 * (reader-actions, E2E-MAIN 2026-11-09). Local release copies are served instead; a missing or
 * different copy is left to the network and not waited for.
 */
async function routeCompanionModules(
  page: Page,
  catalog: {
    readonly modules: readonly {
      id: string;
      artifacts: readonly { url?: string | undefined; sha256: string }[];
    }[];
  },
): Promise<void> {
  const served: string[] = [];
  for (const [moduleId, directory] of [
    [INSTRUCTION_MODULE_ID, INSTRUCTION_DIRECTORY],
    [EAEU_MODULE_ID, EAEU_DIRECTORY],
  ] as const) {
    const artifact = catalog.modules.find((module) => module.id === moduleId)?.artifacts[0];
    if (!artifact?.url) continue;
    const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
    const localPath = resolve(DATA_ROOT, directory, fileName);
    if (!existsSync(localPath)) continue;
    const bytes = await readFile(localPath);
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== artifact.sha256) continue;
    await page.route(
      (url) => url.pathname.endsWith(`/${fileName}`),
      (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
    );
    served.push(moduleId);
  }
  servedCompanions.set(page, served);
}

/**
 * Serves the antiparasitic ГРЛС instruction module's published bytes (the local release copy), the
 * module the drug screen offers when a product has no text; call before mounting. Skips when absent.
 */
export async function routeInstructionModule(
  page: Page,
  moduleId: string = INSTRUCTION_MODULE_ID,
): Promise<void> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const artifact = catalog.modules.find((module) => module.id === moduleId)?.artifacts[0];
  if (!artifact?.url) throw new Error('Missing instruction module artifact');
  const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
  const localPath = resolve(DATA_ROOT, INSTRUCTION_DIRECTORY, fileName);
  test.skip(!existsSync(localPath), `The published module file ${fileName} is local-only.`);
  const bytes = await readFile(localPath);
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
  await page.route(
    (url) => url.pathname.endsWith(`/${fileName}`),
    (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
  );
}

/** Installs the module through its core pointer, as a doctor would, and waits for the document. */
export async function installMedicationModule(page: Page): Promise<void> {
  await page.goto(documentRoute(POINTER));
  await page.locator('.document-module-pointer__action').click();
  await expect(page).toHaveURL(documentRoute('esklp.mnn.албендазол'), { timeout: 90_000 });
  await waitForCompanionModules(page);
}

/**
 * Waits until the companions this page serves are installed and the search core has reloaded with
 * them (`minimed:install:core-reload` names the installed set it serves), so a test starts on the
 * settled screen rather than one that switches its text and remounts its header under it.
 */
async function waitForCompanionModules(page: Page): Promise<void> {
  const companions = servedCompanions.get(page) ?? [];
  if (companions.length === 0) return;
  await expect
    .poll(
      () =>
        page.evaluate((ids) => {
          const raw = localStorage.getItem('localmed.installed-modules.v1');
          const entries = raw
            ? ((JSON.parse(raw) as { entries?: { moduleId: string }[] }).entries ?? [])
            : [];
          const installed = new Set(entries.map((entry) => entry.moduleId));
          if (!ids.every((id) => installed.has(id))) return false;
          // `core:…|modules:<count>.<digest>`: the core counts every module but itself.
          const modules = entries.filter((entry) => entry.moduleId !== 'minimed.core.ru').length;
          const reloads = performance.getEntriesByName('minimed:install:core-reload');
          const last = reloads.at(-1) as
            | (PerformanceEntry & { detail?: { dataVersion?: string } })
            | undefined;
          return last?.detail?.dataVersion?.includes(`|modules:${String(modules)}.`) ?? false;
        }, companions),
      { timeout: 90_000, message: `companions ${companions.join(', ')} installed and searched` },
    )
    .toBe(true);
}

/** Opens the first product card of the medication catalog and returns its title. */
export async function openFirstMedicationCard(page: Page): Promise<string> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page.locator('.medication-product-card').first().click({ timeout: 60_000 });
  const title = page.locator('.drug-header__title');
  await expect(title).toBeVisible({ timeout: 30_000 });
  const text = (await title.textContent())?.trim() ?? '';
  expect(text).not.toBe('');
  return text;
}
