#!/usr/bin/env bash
# Build, verify, sign, and publish the MiniMed Android prerelease locally (saves GitHub Actions quota).
# Usage:
#   bun run release:android:local [--skip-tests] [--dry-run] [--keep-output]
# Requires android-release.local.env (see android-release.local.env.example) and an authenticated `gh` CLI.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PRERELEASE_CERT_SHA256="7749bab3dbe763d9a3c2092ded6e2700f48c3dd86dc9ba780394c1d3684d0b16"
SKIP_TESTS=0
DRY_RUN=0
KEEP_OUTPUT=0

for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --keep-output) KEEP_OUTPUT=1 ;;
    -h|--help)
      echo "Usage: $0 [--skip-tests] [--dry-run] [--keep-output]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

ENV_FILE="$ROOT/android-release.local.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

TEMP_KEYSTORE=""
cleanup() {
  if [ -n "$TEMP_KEYSTORE" ] && [ -f "$TEMP_KEYSTORE" ]; then
    rm -f "$TEMP_KEYSTORE"
  fi
  if [ "$KEEP_OUTPUT" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ -d "$ROOT/release-output" ]; then
    rm -rf "$ROOT/release-output"
  fi
}
trap cleanup EXIT

if [ -z "${MINIMED_ANDROID_KEYSTORE_FILE:-}" ] && [ -n "${MINIMED_ANDROID_KEYSTORE_BASE64:-}" ]; then
  TEMP_KEYSTORE="$(mktemp "${TMPDIR:-/tmp}/minimed-prerelease.XXXXXX.p12")"
  printf '%s' "$MINIMED_ANDROID_KEYSTORE_BASE64" | base64 --decode > "$TEMP_KEYSTORE"
  export MINIMED_ANDROID_KEYSTORE_FILE="$TEMP_KEYSTORE"
fi

if [ -z "${MINIMED_ANDROID_KEYSTORE_FILE:-}" ] || [ ! -f "$MINIMED_ANDROID_KEYSTORE_FILE" ]; then
  echo "Missing signing keystore. Copy android-release.local.env.example to android-release.local.env and set MINIMED_ANDROID_KEYSTORE_FILE (or MINIMED_ANDROID_KEYSTORE_BASE64)." >&2
  exit 1
fi
if [ -z "${MINIMED_ANDROID_KEYSTORE_PASSWORD:-}" ] || [ -z "${MINIMED_ANDROID_KEY_ALIAS:-}" ]; then
  echo "MINIMED_ANDROID_KEYSTORE_PASSWORD and MINIMED_ANDROID_KEY_ALIAS must be set in android-release.local.env." >&2
  exit 1
fi

# Resolve JDK 21
if [ -z "${JAVA_HOME:-}" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"21\.'; then
  if [ -d "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
  elif JAVA_21="$(/usr/libexec/java_home -v 21 2>/dev/null || true)" && [ -n "$JAVA_21" ]; then
    export JAVA_HOME="$JAVA_21"
  fi
fi

# Resolve Android SDK
if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -f "$ROOT/apps/app/android/local.properties" ]; then
    SDK_DIR="$(awk -F= '/^sdk\.dir=/ { print $2; exit }' "$ROOT/apps/app/android/local.properties")"
    if [ -n "$SDK_DIR" ] && [ -d "$SDK_DIR" ]; then
      export ANDROID_HOME="$SDK_DIR"
    fi
  fi
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "/opt/homebrew/share/android-commandlinetools" ]; then
  export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
fi
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "ANDROID_HOME could not be resolved." >&2
  exit 1
fi

BUILD_TOOLS_DIR="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -z "$BUILD_TOOLS_DIR" ] || [ ! -x "$BUILD_TOOLS_DIR/apksigner" ]; then
  echo "Android build-tools (apksigner/aapt) not found under $ANDROID_HOME/build-tools." >&2
  exit 1
fi

RELEASE_VERSION="$(bun -p "require('./release.json').version")"
RELEASE_TAG="v${RELEASE_VERSION}"
APK_NAME="MiniMed-${RELEASE_VERSION}-android-debug.apk"
APK_LATEST_NAME="MiniMed-android.apk"
CORE_DATABASE_NAME="MiniMed-${RELEASE_VERSION}-core.db"
SOURCE_SHA="$(git rev-parse HEAD)"
GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"

echo "==> Local Android release for MiniMed ${RELEASE_VERSION} (${SOURCE_SHA:0:9})"
echo "    JAVA_HOME=${JAVA_HOME:-default}"
echo "    ANDROID_HOME=${ANDROID_HOME}"
echo "    BUILD_TOOLS=${BUILD_TOOLS_DIR}"

if [ "$SKIP_TESTS" -eq 0 ]; then
  env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" bun run check
  env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" bun run typecheck
  env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" bun run test
fi

env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" bun run build:app
env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" bun run native:sync:android

echo "==> Assembling signed APK..."
(
  cd "$ROOT/apps/app/android"
  ./gradlew --no-daemon assembleDebug \
    -Porg.gradle.java.installations.paths="${JAVA_HOME}"
)

rm -rf "$ROOT/release-output"
mkdir -p "$ROOT/release-output"

apk_source="apps/app/android/app/build/outputs/apk/debug/app-debug.apk"
apk="release-output/${APK_NAME}"
apk_latest="release-output/${APK_LATEST_NAME}"
original_db="apps/app/public/content/core.db"
release_db="release-output/${CORE_DATABASE_NAME}"
example_ct="release-output/example-ct.dcm"
example_mri="release-output/example-mri.nii"

test -s "$apk_source"
cp "$apk_source" "$apk"
cp "$apk" "$apk_latest"
cp apps/app/src/assets/example-ct.dcm "$example_ct"
cp apps/app/src/assets/example-mri.nii "$example_mri"

unzip_apk() {
  set +e
  unzip "$@"
  local status=$?
  set -e
  if [ "$status" -eq 0 ] || [ "$status" -eq 1 ]; then
    return 0
  fi
  return "$status"
}

unzip_apk -l "$apk" > release-output/APK-CONTENTS.txt
bun scripts/fetch-query-model.ts --check-apk "$apk"

embedded_path="$(awk '$(NF) ~ /(^|\/)core\.db$/ { print $NF; exit }' release-output/APK-CONTENTS.txt)"
if [ -n "$embedded_path" ]; then
  echo "APK must download core.db at first launch (found embedded $embedded_path)." >&2
  exit 1
fi

"$BUILD_TOOLS_DIR/aapt" dump badging "$apk" > release-output/APK-BADGING.txt
"$BUILD_TOOLS_DIR/aapt" dump permissions "$apk" > release-output/APK-PERMISSIONS.txt
"$BUILD_TOOLS_DIR/apksigner" verify --verbose --print-certs "$apk" > release-output/APK-SIGNATURE.txt

if ! grep -q "Signer #1 certificate SHA-256 digest: ${PRERELEASE_CERT_SHA256}$" release-output/APK-SIGNATURE.txt; then
  echo "APK is NOT signed with the persistent prerelease key (${PRERELEASE_CERT_SHA256})!" >&2
  cat release-output/APK-SIGNATURE.txt >&2
  exit 1
fi

RELEASE_VERSION="$RELEASE_VERSION" \
RELEASE_TAG="$RELEASE_TAG" \
CORE_DATABASE_NAME="$CORE_DATABASE_NAME" \
GITHUB_REPOSITORY="$GITHUB_REPOSITORY" \
SOURCE_SHA="$SOURCE_SHA" \
APK_FILE="$apk" \
python3 - <<'PY'
import hashlib, json, os, sqlite3
from pathlib import Path

apk = Path(os.environ['APK_FILE'])
db_path = Path('apps/app/public/content/core.db')
report = json.loads(Path('apps/app/public/content/core-report.json').read_text(encoding='utf-8'))
db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
try:
    assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    assert len(db.execute('PRAGMA foreign_key_check').fetchall()) == 0
    pack = db.execute('SELECT id, version, schema_version FROM content_packs').fetchone()
    documents = db.execute('SELECT id, title, source_type FROM documents ORDER BY id').fetchall()
    sections = db.execute('SELECT COUNT(*) FROM sections').fetchone()[0]
    chunks = db.execute('SELECT COUNT(*) FROM chunks').fetchone()[0]
    aliases = db.execute('SELECT COUNT(*) FROM aliases').fetchone()[0]
    profiles = db.execute('SELECT COUNT(*) FROM embedding_profiles').fetchone()[0]
    embeddings = db.execute('SELECT COUNT(*) FROM chunk_embeddings').fetchone()[0]
    fts_chunks = db.execute('SELECT COUNT(*) FROM chunks_fts').fetchone()[0]
    assert pack and pack[0] == 'minimed.core.ru' and pack[2] == 2
    assert not report['errors']
    assert len(documents) == report['documents']
    assert sections == report['sections']
    assert chunks == fts_chunks == report['chunks']
    assert aliases == report['aliases']
    assert profiles == report['embeddingProfiles']
    assert embeddings == report['embeddings']
    source_index = [{'documentId': d[0], 'title': d[1], 'sourceType': d[2]} for d in documents]
finally:
    db.close()

apk_sha = hashlib.sha256(apk.read_bytes()).hexdigest()
db_sha = hashlib.sha256(db_path.read_bytes()).hexdigest()
assert f'sha256:{db_sha}' == report['outputChecksum']
evidence = {
    'releaseVersion': os.environ['RELEASE_VERSION'],
    'sourceCommit': os.environ['SOURCE_SHA'],
    'apk': {'path': str(apk), 'sha256': apk_sha, 'bytes': apk.stat().st_size},
    'downloadableDatabase': {
        'url': f'https://github.com/{os.environ["GITHUB_REPOSITORY"]}/releases/download/{os.environ["RELEASE_TAG"]}/{os.environ["CORE_DATABASE_NAME"]}',
        'sha256': db_sha,
        'bytes': db_path.stat().st_size,
        'pack': {'id': pack[0], 'version': pack[1], 'schemaVersion': pack[2]},
        'documents': len(documents),
        'sections': sections,
        'chunks': chunks,
        'aliases': aliases,
        'embeddingProfiles': profiles,
        'embeddings': embeddings,
    },
    'sourceIndex': source_index,
}
Path('release-output/APK-SHA256.txt').write_text(f'{apk_sha}  {apk.name}\n', encoding='utf-8')
Path('release-output/DB-SHA256.txt').write_text(f'{db_sha}  {os.environ["CORE_DATABASE_NAME"]}\n', encoding='utf-8')
Path('release-output/VERIFICATION.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
Path('release-output/SOURCE-INDEX.json').write_text(json.dumps(source_index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f"Verified APK ({apk.stat().st_size / 1e6:.1f} MB, sha256:{apk_sha[:12]}…) and core.db ({len(documents)} docs)")
PY

cp "$original_db" "$release_db"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "==> Dry run complete. Artifacts are in release-output/."
  exit 0
fi

# Extract this version's section from CHANGELOG.md for release notes.
NOTES="$(awk -v ver="## [${RELEASE_VERSION}]" '
  index($0, ver) == 1 { found=1; next }
  found && /^## \[/ { exit }
  found { print }
' CHANGELOG.md)"
if [ -z "${NOTES// }" ]; then
  NOTES="MiniMed ${RELEASE_VERSION} prerelease (built and verified locally)."
fi

echo "==> Publishing GitHub release ${RELEASE_TAG}..."
if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  gh release upload "$RELEASE_TAG" \
    "$apk" "$apk_latest" "$release_db" "$example_ct" "$example_mri" \
    release-output/VERIFICATION.json release-output/APK-SHA256.txt release-output/DB-SHA256.txt \
    --clobber
else
  gh release create "$RELEASE_TAG" \
    "$apk" "$apk_latest" "$release_db" "$example_ct" "$example_mri" \
    release-output/VERIFICATION.json release-output/APK-SHA256.txt release-output/DB-SHA256.txt \
    --title "MiniMed ${RELEASE_VERSION}" \
    --notes "$NOTES" \
    --prerelease \
    --target "$SOURCE_SHA"
fi

if [ "$(gh release view "$RELEASE_TAG" --json isDraft --jq '.isDraft')" != "true" ]; then
  if gh release view android-latest >/dev/null 2>&1; then
    gh release upload android-latest "$apk_latest" --clobber
  else
    gh release create android-latest "$apk_latest" \
      --title "MiniMed Android latest" \
      --notes "$NOTES" \
      --prerelease \
      --target "$SOURCE_SHA"
  fi
fi

echo "==> Published MiniMed ${RELEASE_VERSION} (${RELEASE_TAG}) and updated android-latest."
