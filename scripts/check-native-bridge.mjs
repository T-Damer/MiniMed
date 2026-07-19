import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = {
  androidPlugin:
    'apps/app/android/app/src/main/java/dev/localmed/search/LocalMedDatabasePlugin.java',
  androidActivity: 'apps/app/android/app/src/main/java/dev/localmed/search/MainActivity.java',
  androidManifest: 'apps/app/android/app/src/main/AndroidManifest.xml',
  androidBackupRules: 'apps/app/android/app/src/main/res/xml/backup_rules.xml',
  androidExtractionRules: 'apps/app/android/app/src/main/res/xml/data_extraction_rules.xml',
  iosPlugin: 'apps/app/ios/App/App/LocalMedDatabasePlugin.swift',
  iosBridge: 'apps/app/ios/App/App/LocalMedBridgeViewController.swift',
  iosProject: 'apps/app/ios/App/App.xcodeproj/project.pbxproj',
  storyboard: 'apps/app/ios/App/App/Base.lproj/Main.storyboard',
  typescriptPlugin: 'packages/storage-capacitor/src/plugin.ts',
  database: 'apps/app/public/content/core-demo.db',
  report: 'apps/app/public/content/core-demo-report.json',
};

const entries = await Promise.all(
  Object.entries(files).map(async ([name, path]) => [
    name,
    await readFile(resolve(root, path), name === 'database' ? undefined : 'utf8'),
  ]),
);
const content = Object.fromEntries(entries);

function requireText(name, needle) {
  const value = content[name];
  if (typeof value !== 'string' || !value.includes(needle)) {
    throw new Error(`${files[name]} is missing: ${needle}`);
  }
}

for (const method of ['openPack', 'query', 'searchVectors', 'close']) {
  requireText('typescriptPlugin', `${method}(`);
  requireText('androidPlugin', `void ${method}(`);
  requireText('iosPlugin', `name: "${method}"`);
}
requireText('typescriptPlugin', "registerPlugin<LocalMedDatabasePlugin>('LocalMedDatabase')");
requireText('androidPlugin', '@CapacitorPlugin(name = "LocalMedDatabase")');
requireText('androidActivity', 'registerPlugin(LocalMedDatabasePlugin.class)');
requireText('iosPlugin', 'public let jsName = "LocalMedDatabase"');
requireText('iosBridge', 'registerPluginInstance(LocalMedDatabasePlugin())');
requireText('iosProject', 'LocalMedDatabasePlugin.swift in Sources');
requireText('iosProject', 'LocalMedBridgeViewController.swift in Sources');
requireText('iosProject', 'libsqlite3.tbd in Frameworks');
requireText('storyboard', 'customClass="LocalMedBridgeViewController"');

for (const native of ['androidPlugin', 'iosPlugin']) {
  requireText(native, 'PRAGMA quick_check');
  requireText(native, 'chunks_fts');
  requireText(native, 'chunk_embeddings');
  requireText(native, 'vector_norm');
  requireText(native, 'expectedSha256');
}
requireText('androidPlugin', '".backup"');
requireText('iosPlugin', 'appendingPathExtension("backup")');
requireText('androidPlugin', 'SQLiteDatabase.OPEN_READONLY');
requireText('iosPlugin', 'SQLITE_OPEN_READONLY');
requireText('iosPlugin', 'isExcludedFromBackup = true');
requireText('androidManifest', 'android:fullBackupContent="@xml/backup_rules"');
requireText('androidManifest', 'android:dataExtractionRules="@xml/data_extraction_rules"');
requireText('androidBackupRules', 'path="localmed/content/"');
requireText('androidExtractionRules', 'path="localmed/content/"');

const report = JSON.parse(content.report);
const database = content.database;
if (!(database instanceof Buffer)) throw new Error('Database asset was not read as bytes.');
const actual = `sha256:${createHash('sha256').update(database).digest('hex')}`;
if (report.outputChecksum !== actual) {
  throw new Error(`Published database checksum mismatch: ${report.outputChecksum} != ${actual}`);
}

console.log(`Native bridge source check passed; packaged DB ${actual}.`);
