---
type: "source-file"
file: "content/definition-drafts/catalog.json"
layout: "rows-compact+nl"
---

Заголовок файла `content/definition-drafts/catalog.json`: источники, квитанции, состояние проверки. Записи терминов — в заметках понятий.

```source-file
{
 "version": 1,
 "reviewStatus": "requires-review",
 "publicationState": "local-dev",
 "textKind": "editorial-paraphrase",
 "sources": [
  {
   "id": 1,
   "title": "А. В. Снежневский. Лекции по общей психопатологии — библиотека НЦПЗ",
   "baseUrl": "https://www.psychiatry.ru/lib/1/book/10/chapter/",
   "authority": "professional-reference",
   "accessed": "2026-09-21"
  },
  {
   "id": 2,
   "title": "Толковый словарь психиатрических терминов — копия на Slovar.cc",
   "baseUrl": "https://slovar.cc/med/psih/",
   "authority": "third-party",
   "accessed": "2026-09-21"
  },
  {
   "id": 3,
   "title": "NINDS / NIH — справочник неврологических терминов и состояний",
   "baseUrl": "https://www.ninds.nih.gov/health-information/disorders/",
   "authority": "institutional-reference",
   "accessed": "2026-09-21"
  },
  {
   "id": 4,
   "title": "NIDCD / NIH — сведения о нарушениях речи и коммуникации",
   "baseUrl": "https://www.nidcd.nih.gov/health/",
   "authority": "institutional-reference",
   "accessed": "2026-09-21"
  },
  {
   "id": 5,
   "title": "NHS — справочные сведения о симптомах",
   "baseUrl": "https://www.nhs.uk/",
   "authority": "institutional-reference",
   "accessed": "2026-09-21"
  }
 ],
 "terms": "@terms"
}
```
