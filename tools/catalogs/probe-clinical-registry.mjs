import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { chromium } from '@playwright/test';

const SOURCE_URL = 'https://cr.minzdrav.gov.ru/clin-rec/';
const outputRoot = process.argv[2] ?? 'data/build/official-clinical-registry-probe';
const responseRoot = join(outputRoot, 'responses');
const downloadRoot = join(outputRoot, 'download');

await Promise.all([
  mkdir(outputRoot, { recursive: true }),
  mkdir(responseRoot, { recursive: true }),
  mkdir(downloadRoot, { recursive: true }),
]);

function safeName(value) {
  return value
    .replace(/^https?:\/\//u, '')
    .replace(/[^0-9A-Za-zА-Яа-я._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180);
}

function objectKeys(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.keys(value);
}

function collectObjectArrays(value, path = '$', result = []) {
  if (Array.isArray(value)) {
    const objects = value.filter(
      (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
    );
    if (objects.length > 0) {
      const keys = [...new Set(objects.slice(0, 20).flatMap((item) => objectKeys(item)))].sort();
      result.push({ path, rows: value.length, keys });
    }
    for (let index = 0; index < Math.min(value.length, 10); index += 1) {
      collectObjectArrays(value[index], `${path}[${index}]`, result);
    }
    return result;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      collectObjectArrays(child, `${path}.${key}`, result);
    }
  }
  return result;
}

function clinicalArrayScore(candidate) {
  const normalized = candidate.keys.map((key) => key.toLowerCase());
  const matches = (patterns) =>
    patterns.some((pattern) => normalized.some((key) => key.includes(pattern)));
  let score = Math.min(candidate.rows, 1000) / 100;
  if (matches(['id', 'identifier', 'code'])) score += 8;
  if (matches(['name', 'title', 'наимен'])) score += 8;
  if (matches(['mkb', 'icd', 'мкб'])) score += 6;
  if (matches(['age', 'возраст'])) score += 5;
  if (matches(['developer', 'organization', 'разработ'])) score += 5;
  if (matches(['status', 'статус'])) score += 4;
  if (matches(['date', 'дата'])) score += 3;
  return score;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  locale: 'ru-RU',
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36 MiniMedCatalogProbe/1.0',
});
const page = await context.newPage();

const responseTasks = [];
const responseReport = [];
const consoleMessages = [];
const pageErrors = [];

page.on('console', (message) => {
  consoleMessages.push({ type: message.type(), text: message.text().slice(0, 4000) });
});
page.on('pageerror', (error) => {
  pageErrors.push(String(error).slice(0, 4000));
});
page.on('response', (response) => {
  const task = (async () => {
    const url = response.url();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!parsed.hostname.endsWith('minzdrav.gov.ru')) return;
    const contentType = response.headers()['content-type'] ?? '';
    const entry = {
      url,
      status: response.status(),
      contentType,
      requestMethod: response.request().method(),
      savedAs: null,
      bytes: null,
      arrays: [],
    };
    if (/json/iu.test(contentType)) {
      try {
        const body = await response.body();
        entry.bytes = body.byteLength;
        if (body.byteLength <= 32 * 1024 * 1024) {
          const text = body.toString('utf8');
          const payload = JSON.parse(text);
          const arrays = collectObjectArrays(payload)
            .map((candidate) => ({ ...candidate, score: clinicalArrayScore(candidate) }))
            .sort((left, right) => right.score - left.score || right.rows - left.rows);
          entry.arrays = arrays.slice(0, 20);
          const fileName = `${String(responseReport.length + 1).padStart(3, '0')}-${safeName(url)}.json`;
          await writeFile(join(responseRoot, fileName), `${JSON.stringify(payload, null, 2)}\n`);
          entry.savedAs = `responses/${fileName}`;
        }
      } catch (error) {
        entry.error = String(error).slice(0, 2000);
      }
    }
    responseReport.push(entry);
  })();
  responseTasks.push(task);
});

const navigation = {
  sourceUrl: SOURCE_URL,
  startedAt: new Date().toISOString(),
  finalUrl: null,
  title: null,
  download: null,
  downloadError: null,
};

try {
  await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => undefined);
  await page.waitForTimeout(5_000);
  navigation.finalUrl = page.url();
  navigation.title = await page.title();

  const downloadLocators = [
    page.getByRole('button', { name: /^Скачать$/iu }),
    page.getByRole('link', { name: /^Скачать$/iu }),
    page.getByText(/^Скачать$/iu),
  ];
  for (const locator of downloadLocators) {
    if ((await locator.count()) === 0) continue;
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
      await locator.first().click({ timeout: 20_000 });
      const download = await downloadPromise;
      const suggested = download.suggestedFilename() || 'clinical-registry-export.bin';
      const targetName = safeName(basename(suggested)) || 'clinical-registry-export.bin';
      const target = join(downloadRoot, targetName);
      await download.saveAs(target);
      navigation.download = {
        suggestedFilename: suggested,
        savedAs: `download/${targetName}`,
        sourceUrl: download.url(),
        failure: await download.failure(),
      };
      break;
    } catch (error) {
      navigation.downloadError = String(error).slice(0, 3000);
    }
  }

  await writeFile(join(outputRoot, 'page.html'), await page.content());
  await page.screenshot({ path: join(outputRoot, 'page.png'), fullPage: true });
} finally {
  await Promise.allSettled(responseTasks);
  await context.close();
  await browser.close();
}

const rankedArrays = responseReport
  .flatMap((response) =>
    response.arrays.map((array) => ({
      responseUrl: response.url,
      savedAs: response.savedAs,
      ...array,
    })),
  )
  .sort((left, right) => right.score - left.score || right.rows - left.rows);

await writeFile(
  join(outputRoot, 'probe-report.json'),
  `${JSON.stringify(
    {
      ...navigation,
      completedAt: new Date().toISOString(),
      responses: responseReport.sort((left, right) => left.url.localeCompare(right.url)),
      rankedClinicalArrays: rankedArrays.slice(0, 50),
      consoleMessages,
      pageErrors,
    },
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      finalUrl: navigation.finalUrl,
      title: navigation.title,
      download: navigation.download,
      downloadError: navigation.downloadError,
      jsonResponses: responseReport.filter((entry) => entry.savedAs).length,
      topArray: rankedArrays[0] ?? null,
    },
    null,
    2,
  ),
);
