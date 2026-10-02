/**
 * Fetches one dictionary of the Minzdrav NSI (nsi.rosminzdrav.ru) with its passport.
 *
 * Runs ONLY inside the disposable container started by `scripts/fetch-nsi-dictionary.sh`: the NSI
 * host presents a certificate chain of the Russian national root (Минцифры), which must never be
 * installed on the host. The script downloads that root from the official source, checks it
 * against the published SHA-256 fingerprint and trusts it for this process only.
 *
 * The user key comes from `NSI_USER_TOKEN` and travels only in the request query of the NSI
 * REST API (`userKey`, the API requires it there). It is never printed, written or put into an
 * error message: requests are logged by method and path only.
 *
 * Output (under `--out`, default `/out`): `<dir>/passport.json`, `<dir>/rows.json`,
 * `<dir>/MANIFEST.json` where `<dir>` is `<oid>/v<version>`.
 */
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import tls from 'node:tls';

const ROOT_CA_URL = 'https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt';
/** Published SHA-256 fingerprint of «Russian Trusted Root CA» (valid until 2032-02-27). */
const ROOT_CA_SHA256 =
  'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31';
const NSI_ORIGIN = 'https://nsi.rosminzdrav.ru';
const API_PATH = '/port/rest';
const PAGE_SIZE = 1000;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function fail(message) {
  console.error(`fetch-nsi-dictionary: ${message}`);
  process.exit(1);
}

if (process.env.NSI_FETCH_IN_CONTAINER !== '1') {
  fail('run it through scripts/fetch-nsi-dictionary.sh (a disposable container), not on the host');
}
const token = process.env.NSI_USER_TOKEN;
if (!token) fail('NSI_USER_TOKEN is not set');

const oid = arg('oid', '1.2.643.5.1.13.13.99.2.473');
const label = arg('label', 'atc');
const outRoot = arg('out', '/out');

async function loadRootCa() {
  const response = await fetch(ROOT_CA_URL);
  if (!response.ok) fail(`root CA download answered ${String(response.status)}`);
  const pem = Buffer.from(await response.arrayBuffer()).toString('utf8');
  const fingerprint = new X509Certificate(pem).fingerprint256;
  if (fingerprint !== ROOT_CA_SHA256) {
    fail(`root CA fingerprint ${fingerprint} differs from the published one`);
  }
  return pem;
}

const rootCa = await loadRootCa();
const agent = new https.Agent({ ca: [rootCa, ...tls.rootCertificates], keepAlive: true });

/** GET a REST method; the query (with the key) is built here and never logged. */
function api(method, query) {
  const params = new URLSearchParams({ ...query, userKey: token });
  const path = `${API_PATH}/${method}?${params.toString()}`;
  return new Promise((resolve, reject) => {
    https
      .get(NSI_ORIGIN + path, { agent }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode !== 200) {
            reject(new Error(`${method} answered HTTP ${String(response.statusCode)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`${method} returned a body that is not JSON`));
          }
        });
      })
      .on('error', (error) => {
        reject(new Error(`${method} failed: ${error.code ?? 'network error'}`));
      });
  });
}

function checkResult(method, body) {
  if (body && typeof body === 'object' && body.result === 'ERROR') {
    fail(`${method}: ${body.resultCode ?? ''} ${body.resultText ?? ''}`.trim());
  }
  return body;
}

const versions = checkResult('versions', await api('versions', { identifier: oid, size: '50' }));
const versionList = Array.isArray(versions) ? versions : (versions.list ?? []);
if (versionList.length === 0) fail('versions returned no versions');
/** NSI dates are «dd.mm.yyyy hh:mm»; a plain string sort would order them wrongly. */
function nsiTime(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}))?/u.exec(String(value ?? ''));
  if (!match) return 0;
  const [, day, month, year, hour = '0', minute = '0'] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}
const latest = [...versionList].sort((a, b) => nsiTime(b.publishDate) - nsiTime(a.publishDate))[0];
const version = String(latest.version);

/** The passport without `version` is the current one; it must agree with the version list. */
const current = checkResult('passport', await api('passport', { identifier: oid }));
if (String(current.version) !== version) {
  fail(
    `latest version by date is ${version}, but the current passport is ${String(current.version)}`,
  );
}
const passport = checkResult('passport', await api('passport', { identifier: oid, version }));

const rows = [];
let total = null;
for (let page = 1; ; page += 1) {
  const body = checkResult(
    'data',
    await api('data', { identifier: oid, version, page: String(page), size: String(PAGE_SIZE) }),
  );
  const list = Array.isArray(body) ? body : (body.list ?? []);
  if (typeof body.total === 'number') total = body.total;
  rows.push(...list);
  if (list.length < PAGE_SIZE || (total !== null && rows.length >= total)) break;
}
const expected = passport.rowsCount ?? total;
if (typeof expected === 'number' && rows.length !== expected) {
  fail(`fetched ${String(rows.length)} rows, the dictionary declares ${String(expected)}`);
}

const dir = join(outRoot, label, `v${version}`);
mkdirSync(dir, { recursive: true });
const rowsText = `${JSON.stringify(rows)}\n`;
writeFileSync(join(dir, 'rows.json'), rowsText);
writeFileSync(join(dir, 'passport.json'), `${JSON.stringify(passport, null, 2)}\n`);
const manifest = {
  source: 'Минздрав России, НСИ (nsi.rosminzdrav.ru)',
  sourceUrl: `${NSI_ORIGIN}${API_PATH}/data?identifier=${oid}&version=${version}`,
  passportUrl: `${NSI_ORIGIN}${API_PATH}/passport?identifier=${oid}&version=${version}`,
  publicPage: `${NSI_ORIGIN}/dictionaries/${oid}`,
  oid,
  version,
  publishDate: latest.publishDate ?? passport.publishDate ?? null,
  rowsCount: rows.length,
  knownVersions: versionList.map(
    (entry) => `${String(entry.version)} (${String(entry.publishDate)})`,
  ),
  fetchedAt: new Date().toISOString(),
  rowsFile: 'rows.json',
  rowsBytes: Buffer.byteLength(rowsText),
  rowsSha256: createHash('sha256').update(rowsText).digest('hex'),
  rootCaSha256: ROOT_CA_SHA256,
  note: 'userKey is required by the API and is not recorded.',
};
writeFileSync(join(dir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`fetched ${String(rows.length)} rows, version ${version}, into ${label}/v${version}`);
