/** Exact Web home copy plus checksum-pinned public navigation-document counts. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  documentMatchesSearchScope,
  type SearchScope,
} from '@localmed/app/features/search/ScopedMedicalCore';
import { isSupersededSummaryDocument } from '@localmed/core';
import ts from 'typescript';
import { z } from 'zod';

const root = resolve(import.meta.dirname, '..');
const coreSha256 = '13f238f7fefe1b19eefa19ac9de0ea89fabff34ed96e98d987277f15ab03025f';
const corePath = resolve(root, 'apps/app/public/content/core.db');
const output = resolve(
  root,
  'native/shared/src/commonMain/composeResources/files/native-home-data.json',
);
const reportPath = resolve(root, 'playwright/native-home-validation.json');
const paths = {
  catalog: 'apps/app/src/features/search/searchCatalog.ts',
  examples: 'apps/app/src/features/search/SearchWorkspace.tsx',
  home: 'apps/app/src/features/search/SearchHome.tsx',
  ecg: 'apps/app/src/features/calculators/EcgHomeEntry.tsx',
  picker: 'apps/app/src/features/calculators/EcgPhotoPicker.tsx',
  intro: 'apps/app/src/features/search/SearchHomeIntro.tsx',
  day: 'apps/app/src/features/search/feature-of-day.ts',
  scopes: 'apps/app/src/features/search/ScopedMedicalCore.ts',
  siblings: 'packages/core/src/document-siblings.ts',
  display: 'apps/app/src/features/library/document-display.ts',
  store: 'packages/storage-sqlite/src/sqlite-medical-store.ts',
  mapper: 'packages/core/src/mappers.ts',
  overview: 'apps/app/src/features/search/sections-overview.ts',
} as const;
const files = new Map<string, ts.SourceFile>();
for (const path of Object.values(paths))
  files.set(
    path,
    ts.createSourceFile(
      path,
      await readFile(resolve(root, path), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  );
function source(path: string): ts.SourceFile {
  const file = files.get(path);
  if (!file) throw new Error('Home source is absent');
  return file;
}
function find(file: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (result) return;
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  }
  visit(file);
  if (!result) throw new Error(`Expected source declaration absent: ${file.fileName}`);
  return result;
}
function constant(path: string, name: string): ts.Expression {
  const node = find(
    source(path),
    (entry) => ts.isVariableDeclaration(entry) && entry.name.getText() === name,
  );
  if (!ts.isVariableDeclaration(node) || !node.initializer)
    throw new Error('Expected source initializer absent');
  return node.initializer;
}
function literal(node: ts.Node): unknown {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) throw new Error('Home data must remain literal');
        return [
          ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(),
          literal(property.initializer),
        ];
      }),
    );
  throw new Error('Home data contains unsupported non-literal expression');
}
function provenance(path: string, node?: ts.Node) {
  const file = source(path);
  return {
    path,
    sha256: createHash('sha256').update(file.text).digest('hex'),
    lineStart: node ? file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 : 1,
    lineEnd: node
      ? file.getLineAndCharacterOfPosition(node.getEnd()).line + 1
      : file.getLineAndCharacterOfPosition(file.end).line + 1,
  };
}
const sectionSchema = z.object({
  id: z.enum([
    'all',
    'conditions',
    'guidelines',
    'medications',
    'legal',
    'assessments',
    'calculators',
    'diagnosis',
  ]),
  label: z.string(),
  icon: z.string(),
  countNoun: z.tuple([z.string(), z.string(), z.string()]).optional(),
});
const sections = z
  .array(sectionSchema)
  .parse(literal(constant(paths.catalog, 'SEARCH_SECTIONS')))
  .filter((section) => section.countNoun !== undefined);
const examplesByScope = z
  .record(
    z.enum([
      'conditions',
      'calculators',
      'assessments',
      'diagnosis',
      'guidelines',
      'medications',
      'legal',
      'all',
      'personal',
    ]),
    z.array(z.string()),
  )
  .parse(literal(constant(paths.examples, 'EXAMPLES_BY_SCOPE')));
const featureArray = find(
  source(paths.home),
  (node) =>
    ts.isArrayLiteralExpression(node) &&
    node.parent.getText().startsWith('(): readonly HomeFeature[]'),
);
function attributes(node: ts.JsxSelfClosingElement) {
  const result = new Map<string, ts.JsxAttribute>();
  for (const attribute of node.attributes.properties)
    if (ts.isJsxAttribute(attribute)) result.set(attribute.name.getText(), attribute);
  return result;
}
function attributeString(attribute: ts.JsxAttribute | undefined): string {
  if (!attribute?.initializer || !ts.isStringLiteral(attribute.initializer))
    throw new Error('Home feature text must remain a source literal');
  return attribute.initializer.text;
}
function action(attribute: ts.JsxAttribute | undefined) {
  if (!attribute) return null;
  const initializer = attribute.initializer;
  if (
    !initializer ||
    !ts.isJsxExpression(initializer) ||
    !initializer.expression ||
    !ts.isObjectLiteralExpression(initializer.expression)
  )
    throw new Error('Home action must remain an object literal');
  const properties = new Map<string, ts.Expression>();
  let condition: string | null = null;
  for (const property of initializer.expression.properties) {
    if (ts.isPropertyAssignment(property))
      properties.set(property.name.getText(), property.initializer);
    else if (ts.isSpreadAssignment(property)) condition = property.expression.getText();
    else throw new Error('Unexpected home action property');
  }
  const stringProperty = (name: string): string | null => {
    const node = properties.get(name);
    return node ? z.string().parse(literal(node)) : null;
  };
  const label = stringProperty('label');
  if (!label) throw new Error('Home action label absent');
  return {
    label,
    icon: stringProperty('icon'),
    webHref: stringProperty('href'),
    webAction: properties.get('run')?.getText() ?? null,
    webAvailabilityCondition: condition,
    metadataOnly: true as const,
  };
}
function jsxText(node: ts.JsxElement): string {
  return node.children
    .filter(ts.isJsxText)
    .map((child) => child.text.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join(' ');
}
function elementWithClass(path: string, className: string): ts.JsxElement {
  const node = find(
    source(path),
    (entry) =>
      ts.isJsxElement(entry) &&
      entry.openingElement.attributes.properties.some(
        (property) =>
          ts.isJsxAttribute(property) &&
          property.name.getText() === 'class' &&
          property.initializer &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === className,
      ),
  );
  if (!ts.isJsxElement(node)) throw new Error('Expected Web element absent');
  return node;
}
const pickerPrimary = find(
  source(paths.picker),
  (node) =>
    ts.isConditionalExpression(node) &&
    ts.isStringLiteral(node.whenTrue) &&
    node.whenTrue.text === 'Переснять',
);
if (!ts.isConditionalExpression(pickerPrimary)) throw new Error('ECG source action absent');
const pickerSecondary = elementWithClass(paths.picker, 'ecg-picker__option');
const ecgCallback = find(
  source(paths.ecg),
  (node) => ts.isJsxAttribute(node) && node.name.getText() === 'onFile',
);
type FeatureData = {
  id: string;
  icon: string;
  kicker: string;
  title: string;
  text: string;
  actions: NonNullable<ReturnType<typeof action>>[];
  webVisibility: 'always' | 'experimental-modules-enabled';
  nativeAvailability: 'unqualified';
  provenance: ReturnType<typeof provenance>[];
};
const features: FeatureData[] = [
  {
    id: 'ecg-photo',
    icon: 'heartbeat',
    kicker: jsxText(elementWithClass(paths.ecg, 'ecg-home__kicker')),
    title: jsxText(elementWithClass(paths.ecg, 'ecg-home__title')),
    text: jsxText(elementWithClass(paths.ecg, 'ecg-home__text')),
    actions: [
      {
        label: z.string().parse(literal(pickerPrimary.whenFalse)),
        icon: 'camera',
        webHref: null,
        webAction: ecgCallback.getText(),
        webAvailabilityCondition: null,
        metadataOnly: true as const,
      },
      {
        label: jsxText(pickerSecondary),
        icon: 'image',
        webHref: null,
        webAction: ecgCallback.getText(),
        webAvailabilityCondition: null,
        metadataOnly: true as const,
      },
    ],
    webVisibility: 'always',
    nativeAvailability: 'unqualified',
    provenance: [provenance(paths.ecg), provenance(paths.picker)],
  },
];
function collectCards(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'HomeFeatureCard') {
    const fields = attributes(node);
    const parentObject = (() => {
      let owner: ts.Node = node;
      while (!ts.isObjectLiteralExpression(owner)) {
        if (!owner.parent) throw new Error('Feature owner absent');
        owner = owner.parent;
      }
      return owner;
    })();
    const id = parentObject.properties.find(
      (property) => ts.isPropertyAssignment(property) && property.name.getText() === 'id',
    );
    if (!id || !ts.isPropertyAssignment(id)) throw new Error('Feature id absent');
    const featureId = z.string().parse(literal(id.initializer));
    features.push({
      id: featureId,
      icon: attributeString(fields.get('icon')),
      kicker: attributeString(fields.get('kicker')),
      title: attributeString(fields.get('title')),
      text: attributeString(fields.get('text')),
      actions: [action(fields.get('action')), action(fields.get('secondary'))].filter(
        (entry) => entry !== null,
      ),
      webVisibility: featureId === 'graph' ? 'experimental-modules-enabled' : 'always',
      nativeAvailability: 'unqualified',
      provenance: [provenance(paths.home, parentObject)],
    });
  }
  ts.forEachChild(node, collectCards);
}
collectCards(featureArray);
if (features.map((feature) => feature.id).join(',') !== 'ecg-photo,imaging,conversation,graph')
  throw new Error('Web home feature order changed');
const coreDigest = createHash('sha256');
for await (const bytes of createReadStream(corePath)) coreDigest.update(bytes);
if (coreDigest.digest('hex') !== coreSha256)
  throw new Error('Home input is not exact released core');
const moduleName = 'bun:sqlite';
const sqlite: {
  Database: new (
    path: string,
    options: { readonly: boolean },
  ) => { query(sql: string): { all(): unknown[] }; close(): void };
} = await import(moduleName);
const db = new sqlite.Database(corePath, { readonly: true });
const navigationSchema = z.object({
  id: z.string(),
  versionId: z.string(),
  sourceChecksum: z.string(),
  sourceType: z.string(),
  metadataJson: z.string(),
});
let navigationDocuments: z.infer<typeof navigationSchema>[];
try {
  navigationDocuments = z
    .array(navigationSchema)
    .parse(
      db
        .query(
          'SELECT d.id,d.source_type AS sourceType,d.metadata_json AS metadataJson,dv.id AS versionId,dv.source_checksum AS sourceChecksum FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id ORDER BY d.id',
        )
        .all(),
    );
} finally {
  db.close();
}
const ids = new Set(navigationDocuments.map((document) => document.id));
const visible = navigationDocuments
  .filter((document) => !isSupersededSummaryDocument(document.id, ids))
  .map((document) => ({
    ...document,
    metadata: z.record(z.string(), z.unknown()).parse(JSON.parse(document.metadataJson)),
  }));
const rows = sections.map((section) => {
  const tools = section.id === 'assessments' || section.id === 'calculators';
  const members = visible.filter((document) =>
    documentMatchesSearchScope(document, section.id as SearchScope),
  );
  return {
    ...section,
    navigationDocumentCount: tools ? null : members.length,
    countEntity: tools ? 'tool' : 'navigation-document',
    countProvider: tools ? 'native-tool-runtime' : 'released-core',
    membershipSha256: tools
      ? null
      : createHash('sha256')
          .update(
            JSON.stringify(
              members.map(({ id, versionId, sourceChecksum }) => ({
                id,
                versionId,
                sourceChecksum,
              })),
            ),
          )
          .digest('hex'),
  };
});
const rule = find(
  source(paths.day),
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'featureOfDayIndex',
);
const introText = source(paths.intro).text;
const quotedAttribute = (name: string) => {
  const match = introText.match(new RegExp(`${name}="([^"]+)"`, 'u'));
  if (!match?.[1]) throw new Error('Carousel copy absent');
  return match[1];
};
const fixture = {
  schemaVersion: 1,
  coreSha256,
  sections: rows,
  examplesByScope,
  features,
  carousel: {
    label: quotedAttribute('label'),
    itemLabel: quotedAttribute('itemLabel'),
    autoplayMs: z
      .number()
      .int()
      .parse(literal(constant(paths.intro, 'USEFUL_FEATURES_AUTOPLAY_MS'))),
    initialIndexRule: rule.getText(),
  },
  sourceProvenance: Object.values(paths).map((path) => provenance(path)),
};
const encoded = `${JSON.stringify(fixture, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if ((await readFile(output, 'utf8')) !== encoded)
    throw new Error('Native home data differs from the frozen Web reference; regenerate it.');
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, encoded);
}
await mkdir(dirname(reportPath), { recursive: true });
const report = {
  schemaVersion: 1,
  output: 'native/shared/src/commonMain/composeResources/files/native-home-data.json',
  outputSha256: createHash('sha256').update(encoded).digest('hex'),
  outputBytes: Buffer.byteLength(encoded),
  coreSha256,
  sectionCount: rows.length,
  scopeDocumentCounts: Object.fromEntries(rows.map((row) => [row.id, row.navigationDocumentCount])),
  navigationDocumentCount: navigationDocuments.length,
  preferredReadableDocumentCount: visible.length,
  featureCount: features.length,
  exampleScopeCount: Object.keys(examplesByScope).length,
  sourceProvenance: fixture.sourceProvenance,
  countContract:
    'actual documentMatchesSearchScope + actual isSupersededSummaryDocument over readonly current-version navigation rows; unique document IDs, pointers included, no module-edition counts',
  limitations: [
    'Feature actions are metadata only; native capability is unqualified.',
    'Tool counts deliberately absent; root uses actual runtime native tool bank.',
    'Scope counts describe released core navigation documents, not full catalog package inventories.',
  ],
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    sectionCount: rows.length,
    featureCount: features.length,
    outputBytes: report.outputBytes,
    outputSha256: report.outputSha256,
    scopeDocumentCounts: report.scopeDocumentCounts,
  }),
);
