import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  loadToolModuleRecords,
  TOOL_MODULE_FILES,
} from '@localmed/app/features/calculators/tool-module-test-helpers';
import { TOOL_CATALOG } from '@localmed/app/features/modules/module-catalog-shell';
import { AssessmentDefinitionSchema, CalculatorSchemaSchema } from '@localmed/contracts';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const files = [...TOOL_MODULE_FILES, 'content/tool-modules/pediatrics-growth.json'];
const records = loadToolModuleRecords(files);
if (new Set(records.map((record) => record.id)).size !== records.length)
  throw new Error('Duplicate tool identity');
for (const record of records) {
  const definition =
    record.kind === 'calculator'
      ? CalculatorSchemaSchema.parse(record.definition)
      : AssessmentDefinitionSchema.parse(record.definition);
  if (definition.id !== record.id) throw new Error('Tool payload identity mismatch');
}

// Decode reviewed literal data only. No evaluation or execution of source expressions.
function literal(node: ts.Expression): unknown {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
    return literal(node.expression);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const value = literal(node.operand);
    if (typeof value === 'number') return -value;
  }
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((element) => {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element))
        throw new Error('Unsupported reference table array');
      return literal(element);
    });
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const property of node.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      )
        throw new Error('Unsupported reference table property');
      if (Object.hasOwn(result, property.name.text))
        throw new Error('Duplicate reference table key');
      result[property.name.text] = literal(property.initializer);
    }
    return result;
  }
  throw new Error('Reference table must contain static literals');
}

async function table(path: string, name = 'TABLES') {
  const bytes = await readFile(resolve(root, path));
  const source = ts.createSourceFile(path, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  const declarations = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name);
  const initializer = declarations[0]?.initializer;
  if (declarations.length !== 1 || !initializer)
    throw new Error('Expected one reviewed reference table');
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tables: literal(initializer),
  };
}

const output = {
  schemaVersion: 1,
  catalogOrder: [
    ...new Set([
      ...TOOL_CATALOG.map((record) => record.id).filter((id) =>
        records.some((record) => record.id === id),
      ),
      ...records.map((record) => record.id),
    ]),
  ],
  catalogSource: {
    path: 'apps/app/src/features/modules/catalog.shell.json',
    sha256: createHash('sha256')
      .update(await readFile(resolve(root, 'apps/app/src/features/modules/catalog.shell.json')))
      .digest('hex'),
  },
  modules: await Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(resolve(root, path));
      const module: { id: string; version: string; schemaVersion: number; tools: unknown[] } =
        JSON.parse(bytes.toString('utf8'));
      if (module.schemaVersion !== 2 || !module.id || !module.version)
        throw new Error('Unsupported source tool module');
      return {
        path,
        id: module.id,
        version: module.version,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        toolCount: module.tools.length,
      };
    }),
  ),
  records,
  who: await table('apps/app/src/features/calculators/who-growth-reference-data.ts'),
  aap: await table('apps/app/src/features/calculators/aap-pediatric-bp-reference-data.ts'),
  gail: await table('apps/app/src/features/calculators/calculator-models.ts', 'GAIL_MODEL_DATA'),
};
const path = resolve(
  root,
  'native/shared/src/commonMain/composeResources/files/native-tool-data.json',
);
await mkdir(dirname(path), { recursive: true });
await writeFile(path, `${JSON.stringify(output)}\n`);
console.log(JSON.stringify({ modules: output.modules.length, tools: records.length }));
