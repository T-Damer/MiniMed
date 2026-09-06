from pathlib import Path
import hashlib

p = Path('apps/app/src/features/network/native-download.ts')
s = p.read_text()
s = s.replace("import { LocalMedDatabase } from '@localmed/storage-capacitor';\n", '')
s = s.replace('headers: options.headers,', '...(options.headers ? { headers: options.headers } : {}),')
s = s.replace('signal: options.signal,', 'signal: options.signal ?? null,')
s = s.replace('  const plugin = await getPlugin();\n  transport ??=', "  const plugin = await getPlugin();\n  const { LocalMedDatabase } = await import('@localmed/storage-capacitor');\n  transport ??=")
p.write_text(s)

p = Path('scripts/check-native-bridge.mjs')
s = p.read_text().replace("['hasCorePack', 'downloadCorePack']", "['hasCorePack', 'prepareNativeDownload', 'inspectNativeDownload', 'installDownloadedCore']")
p.write_text(s)

p = Path('node_modules/@capgo/capacitor-downloader/android/src/main/java/ee/forgr/capacitor/plugin/downloader/CapacitorDownloaderPlugin.java')
s = p.read_text()
blob = hashlib.sha1(b'blob '+str(len(s.encode())).encode()+b'\0'+s.encode()).hexdigest()
assert blob == '99527642fe238c502b83af9a34c6ce7debe046b4', f'Unexpected prepared dependency: {blob}'
a = '        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))\n'
assert s.count(a) == 1
s = s.replace(a, a + '''            .setTitle("Загрузка данных MiniMed")
            // An opaque stable marker survives enqueue-before-journal interruption even while
            // COLUMN_LOCAL_URI is null. It contains no URL, credentials or clinical content.
            .setDescription("minimed-transfer:" + id)
''')
a = '''                if (!destination.equals(local)) continue;
                String storedUrl = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_URI));
'''
assert s.count(a) == 1
s = s.replace(a, '''                String description = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_DESCRIPTION));
                long nativeId = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
                boolean journalMatch = Long.valueOf(nativeId).equals(downloads.get(id));
                boolean markerMatch = ("minimed-transfer:" + id).equals(description);
                if (!journalMatch && !markerMatch && !destination.equals(local)) continue;
                if (local != null && !destination.equals(local)) throw new java.io.IOException("Conflicting staged path");
                String storedUrl = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_URI));
''')
p.write_text(s)

p = Path('docs/adr/0018-bundled-android-sqlite-and-native-file-transfers.md')
s = p.read_text().replace('URI and original URL, reuses an existing transfer,', 'URI, opaque system-record marker and original URL (also while the pending file URI is null), reuses an existing transfer,')
s = s.replace('executes the bundled FTS5 binary', 'also exercises the real DownloadManager across plugin recreation and a missing journal entry; this is not an OS process-kill test. SQLite instrumentation executes the bundled FTS5 binary')
p.write_text(s)
