# Prompt for manual ChatGPT drug/clinical enrichment

Use this prompt in a normal ChatGPT conversation, then paste a manageable batch of JSONL tasks produced by `medbase ai-export`.

---

Ты обрабатываешь медицинские источники для офлайн-поиска врачей. На входе — независимые JSON-объекты, каждый содержит `taskId`, сведения об источнике и точный `text` одного фрагмента.

Верни **ровно один JSON-объект на каждую входную строку**, тоже в формате JSONL. Не используй Markdown и не добавляй пояснения между объектами.

## Главные ограничения

1. Извлекай клинический факт или связь только тогда, когда можешь приложить `evidenceQuote`, дословно встречающийся в `text`.
2. Не используй знания модели, память, догадки или сведения из другого фрагмента как доказательство.
3. Не дополняй отсутствующие дозы, возрастные пределы, максимальные дозы, противопоказания, взаимодействия, правила рецепта или юридический статус.
4. Если важного поля нет, создай `reviewTask` с `missingFields`; не создавай вымышленный факт.
5. Отличай официальную инструкцию, клиническую рекомендацию, формуляр, статью, профессиональный консенсус, сторонний источник и анекдотическое утверждение.
6. Отличай одобренное применение от off-label, противопоказания, отсутствия данных и простого упоминания.
7. Не помечай ничего как `reviewed`. Импортер всё равно принудительно сохранит статус `proposed`.
8. Не превращай пример поиска или перечисление в рекомендацию по назначению.
9. Сохраняй юрисдикцию и популяцию. Для детей отдельно отмечай возраст, массу, гестационный/постнатальный возраст, если они прямо указаны.
10. Используй стабильные локальные `key` внутри одного ответа; связи могут ссылаться только на ключи сущностей из этого же ответа.
11. Поле `source.authorityTier` во входной задаче является авторитетным. Повтори этот уровень в фактах и связях; импортер всё равно принудительно возьмёт уровень из метаданных источника.

## Категории сущностей

Используй расширяемые строки, например:

- `condition`
- `symptom`
- `medication`
- `drug-class`
- `non-drug-intervention`
- `care-topic`
- `administrative-rule`
- `investigation`
- `population`

Для `medication` заполняй `medication` только теми полями, которые прямо доступны: `conceptLevel`, `inn`, `atcCode`, `dosageForm`, `route`, `strength`, `registrationNumber`, `registrationStatus`, `pediatricStatus`.

## Категории фактов

Предпочтительные `factType`:

- `indication`
- `dosage`
- `pediatric-use`
- `renal-adjustment`
- `hepatic-adjustment`
- `contraindication`
- `warning`
- `interaction`
- `adverse-effect`
- `administration`
- `monitoring`
- `pregnancy`
- `lactation`
- `overdose`
- `prescription-rule`
- `storage`
- `registration-status`
- `treatment-mention`
- `non-drug-care`

`text` должен быть кратким утверждением, не выходящим за смысл `evidenceQuote`. В `structured` можно вынести явно указанные числа/единицы/частоту/маршрут. В `population` — явно указанную популяцию.

## Authority tier

Выбери одно значение:

- `official-registry`
- `official-label`
- `clinical-guideline`
- `formulary`
- `peer-reviewed`
- `professional-consensus`
- `third-party`
- `anecdotal`
- `synthetic-fixture`

Не повышай уровень только из-за уверенного тона текста; учитывай `source.sourceType` и метаданные задачи.

## Формат ответа

```json
{
  "schemaVersion": 1,
  "taskId": "точно как во входе",
  "entities": [
    {
      "key": "drug-1",
      "entityType": "medication",
      "canonicalName": "...",
      "aliases": [],
      "externalIds": {},
      "medication": null,
      "metadata": {}
    }
  ],
  "facts": [
    {
      "entityKey": "drug-1",
      "factType": "pediatric-use",
      "text": "...",
      "evidenceQuote": "точная подстрока text",
      "structured": {},
      "population": {},
      "approvalStatus": "approved-label | guideline-supported-off-label | contraindicated | insufficient-data | not-specified",
      "authorityTier": "official-label",
      "confidence": 0.0,
      "missingFields": []
    }
  ],
  "relations": [
    {
      "subjectKey": "drug-1",
      "predicate": "recommended-for | off-label-for | contraindicated-for | alternative-for | mentioned-for | member-of",
      "objectKey": "condition-1",
      "relationStatus": "recommended | supported-off-label | contraindicated | reference-only | uncertain",
      "evidenceQuote": "точная подстрока text",
      "authorityTier": "clinical-guideline",
      "evidenceQuality": 0.0,
      "applicability": 0.0,
      "recency": 0.0,
      "confidence": 0.0
    }
  ],
  "reviewTasks": [
    {
      "taskType": "missing-source-data | conflict | ambiguous-entity | needs-clinical-review",
      "targetKey": "drug-1",
      "question": "...",
      "missingFields": ["pediatric-dose"],
      "priority": 80
    }
  ]
}
```

Поля-массивы должны присутствовать даже когда пусты. JSON должен быть валидным и находиться в одной строке.

---

After ChatGPT returns the batch, save it as UTF-8 JSONL and run `medbase ai-import`. A successful import means the structure and evidence pointers are valid; it does **not** mean the medical content has passed clinical review.
