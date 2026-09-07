#!/usr/bin/env bash
# Only for a disposable Android CI emulator. Never run against a user's installed application.
set -euo pipefail
mkdir -p /tmp/native-device
adb install -r apps/app/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r apps/app/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
python3 - <<'PY'
import json,hashlib,pathlib
p=pathlib.Path('apps/app/public/content/core.db')
checksum=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
assert 'sha256:'+checksum==json.loads(pathlib.Path('apps/app/public/content/core-report.json').read_text())['outputChecksum']
pathlib.Path('/tmp/core.sha256').write_text(checksum+'\n')
pathlib.Path('/tmp/native-device/scope.txt').write_text(f'Real core: {p.stat().st_size} bytes, sha256:{checksum}. x86 storage test excludes ARM inference. Real SQLite and DownloadManager; plugin recreation is not OS process-kill qualification.\n')
PY
adb shell run-as dev.localmed.search mkdir -p files/localmed/content
adb push apps/app/public/content/core.db /data/local/tmp/minimed-core.db
adb push /tmp/core.sha256 /data/local/tmp/minimed-core.sha256
adb shell run-as dev.localmed.search cp /data/local/tmp/minimed-core.db files/localmed/content/core.db
adb shell run-as dev.localmed.search cp /data/local/tmp/minimed-core.sha256 files/localmed/content/core.db.sha256
adb shell rm /data/local/tmp/minimed-core.db /data/local/tmp/minimed-core.sha256
adb shell svc wifi disable
adb shell svc data disable
adb logcat -c
# Preserve the last native failure even if the emulator disconnects before instrumentation returns.
adb logcat -v threadtime -s LocalMedDatabase:I AndroidRuntime:E > /tmp/native-device/runtime-logcat.txt &
minimed_logcat_pid=$!
trap 'kill "$minimed_logcat_pid" 2>/dev/null || true' EXIT
adb shell am instrument -w -r -e class dev.localmed.search.BundledSqliteTest,dev.localmed.search.NativeDownloaderTest dev.localmed.search.test/androidx.test.runner.AndroidJUnitRunner | tee /tmp/native-device/instrumentation.txt
adb logcat -d -s MiniMedSqliteTest:I MiniMedDownloadTest:I LocalMedDatabase:I > /tmp/native-device/native-timings.txt
grep -F 'OK (4 tests)' /tmp/native-device/instrumentation.txt
adb shell am force-stop dev.localmed.search
adb shell am start -W -n dev.localmed.search/.MainActivity
sleep 45
adb logcat -d -s LocalMedDatabase:I AndroidRuntime:E > /tmp/native-device/app-startup.txt
adb exec-out screencap -p > /tmp/native-device/app.png
grep -F 'openPack success' /tmp/native-device/app-startup.txt
