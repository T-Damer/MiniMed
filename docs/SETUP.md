# Настройка на новой машине

## Требования

- Git;
- Node.js `22.16.x` или совместимый `>=22.12`;
- Bun `1.2.3`;
- Python `3.12+`;
- `uv`;
- Chromium только для E2E;
- Android Studio + SDK + JDK 21 для Android;
- macOS + Xcode для iOS.

Версии-подсказки находятся в `.node-version`, `.python-version` и `packageManager`.

## Из Git bundle

```bash
git clone localmed-search.bundle localmed-search
cd localmed-search
```

## Из ZIP

```bash
unzip localmed-search.zip
cd localmed-search
```

ZIP — чистый снимок исходников без `.git`. Чтобы сохранить подготовленную историю коммитов, используй Git bundle.

## Bootstrap

Linux/macOS:

```bash
./scripts/bootstrap.sh
```

Windows PowerShell:

```powershell
./scripts/bootstrap.ps1
```

Ручной эквивалент:

```bash
corepack enable
bun install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
bun run verify
```

## Запуск

Приложение:

```bash
bun run dev
```

Лендинг:

```bash
bun run dev:landing
```

Production builds:

```bash
bun run build
```

## Частный пилотный корпус

```bash
cp docs/examples/private-sources.yaml data/raw/sources.yaml
# Добавить PDF/TXT в data/raw и исправить registry.

bun run content:prepare:private
bun run content:lint:private
bun run content:build:private
```

`data/raw`, `data/intermediate` и частные build-артефакты игнорируются Git по умолчанию.
Подробности: [`PILOT_CORPUS.md`](PILOT_CORPUS.md).

## Android

```bash
bun run build:app
bun run native:sync:android
bun run native:source:check
bun run --filter @localmed/app cap:open:android
```

Либо CLI build после настройки `ANDROID_HOME`:

```bash
cd apps/app/android
./gradlew assembleDebug
```

## iOS

Только на macOS:

```bash
bun run build:app
bun run native:sync:ios
bun run native:source:check
bun run --filter @localmed/app cap:open:ios
```

## GitHub

```bash
git remote add origin git@github.com:<owner>/localmed-search.git
git push -u origin main
```

Для лендинга настрой GitHub Pages на источник `GitHub Actions`. Workflow автоматически передаёт
repository URL и base path.
