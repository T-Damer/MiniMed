# Настройка на новой машине

## Требования

- Git;
- Node.js `22.16.x` или совместимый `>=22.12`;
- Corepack/pnpm `11.13.1`;
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
pnpm install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
pnpm verify
```

## Запуск

Приложение:

```bash
pnpm dev
```

Лендинг:

```bash
pnpm dev:landing
```

Production builds:

```bash
pnpm build
```

## Частный пилотный корпус

```bash
cp docs/examples/private-sources.yaml data/raw/sources.yaml
# Добавить PDF/TXT в data/raw и исправить registry.

pnpm content:prepare:private
pnpm content:lint:private
pnpm content:build:private
```

`data/raw`, `data/intermediate` и частные build-артефакты игнорируются Git по умолчанию.
Подробности: [`PILOT_CORPUS.md`](PILOT_CORPUS.md).

## Android

```bash
pnpm build:app
pnpm native:sync:android
pnpm native:source:check
pnpm --filter @localmed/app cap:open:android
```

Либо CLI build после настройки `ANDROID_HOME`:

```bash
cd apps/app/android
./gradlew assembleDebug
```

## iOS

Только на macOS:

```bash
pnpm build:app
pnpm native:sync:ios
pnpm native:source:check
pnpm --filter @localmed/app cap:open:ios
```

## GitHub

```bash
git remote add origin git@github.com:<owner>/localmed-search.git
git push -u origin main
```

Для лендинга настрой GitHub Pages на источник `GitHub Actions`. Workflow автоматически передаёт
repository URL и base path.
