# MiniMed UI localization

MiniMed uses the [Mozilla WebExtensions `browser.i18n`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/i18n) message catalog format, bundled at build time for the SolidJS app shell.

## File layout

```text
apps/app/_locales/<lang>/messages.json
apps/app/src/i18n/browser-i18n.ts   # getMessage / getUILanguage / detectLanguage shim
apps/app/src/i18n/labels.ts         # corpus slug → message key helpers
```

Default product locale is Russian (`ru`). English (`en`) is available for development and future UI language switching.

## Adding a string

1. Add a message entry to `apps/app/_locales/ru/messages.json`:

```json
"my_feature_title": {
  "message": "Заголовок",
  "description": "Short note for translators"
}
```

2. Call it from UI code:

```ts
import { browserI18n } from '@/i18n';

browserI18n.getMessage('my_feature_title');
```

3. For corpus-backed slugs (specialties, collections), add `specialty_<slug>` or `collection_<id>` keys and use helpers from `@/i18n/labels`.

Substitutions follow the WebExtensions convention: `$1`, `$2`, or named placeholders declared in `placeholders`.

## Rules

- Keep English slugs in data (`pediatrics`, `pulmonology`); localize only at the UI boundary.
- Do not add third-party i18n libraries for app-shell copy.
- Add the Russian message first; mirror to `en` only when the string is user-visible in both locales.
