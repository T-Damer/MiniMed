import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const SOURCE_URL = 'https://cr.minzdrav.gov.ru/clin-rec/';
const TARGET_OPERATION = 'GetJsonClinrecsFilterV2';
const outputRoot = process.argv[2] ?? 'data/build/official-clinical-registry-probe';
const responseRoot = join(outputRoot, 'responses');

await Promise.all([
  mkdir(outputRoot, { recursive: true }),
  mkdir(responseRoot, { recursive: true }),
]);

function safeName(value) {
  return value
    .replace(/^https?:\/\//u, '')
    .replace(/[^0-9A-Za-zА-Яа-я._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function selectedHeaders(headers) {
  const allowed = new Set(['accept', 'content-type', 'origin', 'referer', 'x-requested-with']);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => allowed.has(key.toLowerCase())),
  );
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'ru-RU',
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36 MiniMedCatalogProbe/2.0',
});
const page = await context.newPage();

const consoleMessages = [];
const pageErrors = [];
const responseTasks = [];
const responseReport = [];
let targetRequest = null;
let targetPayload = null;

page.on('console', (message) => {
  consoleMessages.push({ type: message.type(), text: message.text().slice(0, 4000) });
});
page.on('pageerror', (error) => {
  pageErrors.push(String(error).slice(0, 4000));
});
page.on('request', (request) => {
  if (!request.url().includes(TARGET_OPERATION)) return;
  const postData = request.postData();
  targetRequest = {
    url: request.url(),
    method: request.method(),
    headers: selectedHeaders(request.headers()),
    postData,
    postDataSha256: postData === null ? null : sha256(postData),
  };
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
      method: response.request().method(),
      savedAs: null,
      bytes: null,
      sha256: null,
    };
    if (/json/iu.test(contentType)) {
      try {
        const body = await response.body();
        entry.bytes = body.byteLength;
        entry.sha256 = sha256(body);
        if (body.byteLength <= 32 * 1024 * 1024) {
          const payload = JSON.parse(body.toString('utf8'));
          const fileName = `${String(responseReport.length + 1).padStart(3, '0')}-${safeName(url)}.json`;
          await writeFile(join(responseRoot, fileName), `${JSON.stringify(payload, null, 2)}\n`);
          entry.savedAs = `responses/${fileName}`;
          if (url.includes(TARGET_OPERATION)) targetPayload = payload;
        }
      } catch (error) {
        entry.error = String(error).slice(0, 2000);
      }
    }
    responseReport.push(entry);
  })();
  responseTasks.push(task);
});

const report = {
  sourceUrl: SOURCE_URL,
  startedAt: new Date().toISOString(),
  finalUrl: null,
  title: null,
  targetRequest: null,
  targetSummary: null,
  responses: [],
  consoleMessages,
  pageErrors,
};
const registryPages = [];

try {
  const targetResponsePromise = page.waitForResponse(
    (response) => response.url().includes(TARGET_OPERATION) && response.ok(),
    { timeout: 120_000 },
  );
  await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await targetResponsePromise;
  await page.waitForTimeout(2_000);
  if (!targetRequest?.postData || !targetPayload) {
    throw new Error('Official clinical registry request payload was not captured.');
  }
  const requestTemplate = JSON.parse(targetRequest.postData);
  const pageSize = 200;
  const totalPages = Math.ceil(Number(targetPayload.TotalRecords) / pageSize);
  for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
    const requestPayload = { ...requestTemplate, pageSize, currentPage };
    const response = await context.request.post(targetRequest.url, {
      headers: targetRequest.headers,
      data: requestPayload,
      timeout: 120_000,
    });
    if (!response.ok()) {
      throw new Error(`Official registry returned HTTP ${response.status()}.`);
    }
    const responsePayload = await response.json();
    registryPages.push({
      page: currentPage,
      request: requestPayload,
      response: responsePayload,
    });
  }
  await writeFile(
    join(outputRoot, 'api-pages.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        source: SOURCE_URL,
        apiUrl: targetRequest.url,
        pages: registryPages,
      },
      null,
      2,
    )}\n`,
  );
  report.finalUrl = page.url();
  report.title = await page.title();
  await writeFile(join(outputRoot, 'page.html'), await page.content());
  await page.screenshot({ path: join(outputRoot, 'page.png'), fullPage: true });
} finally {
  await Promise.allSettled(responseTasks);
  await context.close();
  await browser.close();
}

report.targetRequest = targetRequest;
report.responses = responseReport.sort((left, right) => left.url.localeCompare(right.url));
if (targetPayload && typeof targetPayload === 'object' && !Array.isArray(targetPayload)) {
  report.targetSummary = {
    currentPage: targetPayload.CurrentPage ?? null,
    pageSize: targetPayload.PageSize ?? null,
    totalRecords: targetPayload.TotalRecords ?? null,
    rows: Array.isArray(targetPayload.Data) ? targetPayload.Data.length : null,
    rowKeys:
      Array.isArray(targetPayload.Data) && targetPayload.Data.length > 0
        ? Object.keys(targetPayload.Data[0]).sort()
        : [],
  };
}
report.completedAt = new Date().toISOString();
report.completeRegistry = {
  pages: registryPages.length,
  records: registryPages.reduce(
    (count, entry) => count + (Array.isArray(entry.response?.Data) ? entry.response.Data.length : 0),
    0,
  ),
};

await writeFile(join(outputRoot, 'probe-report.json'), `${JSON.stringify(report, null, 2)}\n`);

if (!targetRequest) throw new Error('Official clinical registry request was not observed.');
if (!report.targetSummary || Number(report.targetSummary.totalRecords) <= 0) {
  throw new Error('Official clinical registry returned no records.');
}

console.log(
  JSON.stringify(
    {
      finalUrl: report.finalUrl,
      targetRequest: report.targetRequest,
      targetSummary: report.targetSummary,
      completeRegistry: report.completeRegistry,
      jsonResponses: report.responses.filter((entry) => entry.savedAs).length,
    },
    null,
    2,
  ),
);
