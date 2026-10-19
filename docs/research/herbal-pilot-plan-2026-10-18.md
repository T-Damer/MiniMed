# Herbal book («Травник») pilot: 30 plants

Status: built 2026-10-19 (STATE HERB1, see `docs/CURRENT_STATE.md` «Herbal book «Травник» pilot»). This
is an optional, downloadable reference for self-education and for when herbs are all that is available. It
never replaces official instructions or clinical recommendations.

**Outcome against this plan (2026-10-19).** Built as planned, with these changes:

- **Plates:** Köhler where Commons has a plate (21), otherwise Thomé (4), Sturm (St John's wort) and
  Lindman (field horsetail); plates ship at ≤1200 px (JPEG q85, 7.0 MB in all), not 1600 px.
- **Dr. Duke's database** was not used: its activity claims are untyped lab notes in English, while the EMA
  assessment reports give the constituent → effect link with an evidence level. Its fetch was removed.
- **ГФ XV:** only ОФС.1.4.1.0018 «Настои и отвары» carries home-preparation rules; the articles on
  tinctures, teas and extracts are laboratory quality control and were dropped. The article text is the
  page HTML; the PDF the page links is the approving order (№448 of 25.08.2023).
- **ГРЛС:** viola's only text is an amendment notice, so its chapter is EMA-only; anise is OCR.
- **EMA quote check** gained a reading-order fallback for PDFs whose text spans are stored out of order
  (oak bark), with spaces ignored, and checks numbers in the population field too.
- **Search:** chapters are found in «Все источники»; a separate «Травник» search section is not built yet.

## 1. Sources and what each one contributes

| Layer | Source | Language / rights | Gives |
| --- | --- | --- | --- |
| Official use, brewing, who must not take it | **ГРЛС instructions** for registered herbal raw material («Ромашки аптечной цветки», …) | RU, official document | composition («Характеристика»), action, indications, contraindications, **step-by-step brewing** (e.g. 9 g in 200 ml, 15 min water bath, 45 min cooling), dose by age, side effects, pregnancy and children notes |
| European evidence level, age limits, interactions | **EMA/HMPC EU herbal monographs** + assessment reports | EN; «reproduction is authorised provided the source is acknowledged» | well-established vs traditional use, posology per preparation (tea, tincture, extract), age limits, duration, pregnancy, interactions; the assessment report lists **constituents and their pharmacology** |
| Components → effects | EMA assessment reports (§ constituents, § non-clinical pharmacology) + **Dr. Duke's Phytochemical DB** (USDA) | EN; Duke is CC0 | which constituent is linked to which action, with the evidence level (clinical, animal, in vitro) |
| How to make it yourself | **ГФ XV general monographs**: «Настои и отвары», «Настойки», «Экстракты» | RU, official document | general ratios and methods that work with any herb (not collected yet) |
| Pictures | **Köhler's Medizinal-Pflanzen** (1887–1898), fallback **Thomé, Flora von Deutschland** (1885) via Wikimedia Commons | public domain | one colour botanical plate per plant |

## 2. ГРЛС coverage (catalog 02.10.2026, local text manifest)

- About 770 current registrations look like herbal products by name. Of those, **79 distinct single plants** are
  registered as raw material: herb, leaves, flowers, roots, bark, fruits and seeds.
- **55 of the 79 plants** already have at least one prepared instruction text locally
  (`data/build/grls-instruction-text-manifest.jsonl`). Brewing, indications, contraindications and children
  notes are present as sections (checked on «Ромашки цветки», ЛП-№(012192)-(РГ-RU)).
- **EMA:** 251 entries, of which 182 are finalised and 59 are monographs under periodic review. 50 of the 79 plants
  have a monograph or public statement.
- **Plates:** Köhler covers 35 of the 79 plants. Thomé adds about 15 more, among them nettle, calendula,
  motherwort, birch, oak and plantain.

## 3. Pilot list: ГРЛС text + EMA document + plate

| Plant | Botanical name | ГРЛС registrations / texts | EMA | Plate |
| --- | --- | --- | --- | --- |
| Ромашка аптечная | *Matricaria chamomilla* | 21 / 8 (4 OCR) | Matricariae flos | Köhler |
| Валериана лекарственная | *Valeriana officinalis* | 14 / 6 (2 OCR) | Valerianae radix | Köhler |
| Мята перечная | *Mentha × piperita* | 13 / 3 (1 OCR) | Menthae piperitae folium | Köhler |
| Мелисса лекарственная | *Melissa officinalis* | 10 / 5 (4 OCR) | Melissae folium | Köhler |
| Шалфей лекарственный | *Salvia officinalis* | 14 / 5 (1 OCR) | Salviae officinalis folium | Köhler |
| Тысячелистник | *Achillea millefolium* | 14 / 5 (3 OCR) | Millefolii herba | Köhler |
| Липа сердцевидная | *Tilia cordata* | 14 / 5 (1 OCR) | Tiliae flos | Köhler |
| Дуб (кора) | *Quercus robur* | 13 / 5 (1 OCR) | Quercus cortex | Thomé |
| Крушина ольховидная | *Frangula alnus* | 16 / 4 (1 OCR) | Frangulae cortex | Köhler |
| Сенна | *Senna alexandrina* | 13 / 3 (1 OCR) | Sennae folium | Köhler |
| Солодка | *Glycyrrhiza glabra* | 11 / 2 | Liquiritiae radix | Köhler |
| Полынь горькая | *Artemisia absinthium* | 9 / 4 (2 OCR) | Absinthii herba | Köhler |
| Золототысячник | *Centaurium erythraea* | 5 / 1 | Centaurii herba | Köhler |
| Одуванчик | *Taraxacum officinale* | 4 / 2 (1 OCR) | Taraxaci radix cum herba | Köhler |
| Фенхель | *Foeniculum vulgare* | 4 / 2 (1 OCR) | Foeniculi fructus | Köhler |
| Анис | *Pimpinella anisum* | 2 / 1 (1 OCR) | Anisi fructus | Köhler |
| Лён посевной | *Linum usitatissimum* | 7 / 2 (1 OCR) | Lini semen | Köhler |
| Можжевельник | *Juniperus communis* | 4 / 1 | Juniperi galbulus | Köhler |
| Лапчатка прямостоячая | *Potentilla erecta* | 7 / 1 | Tormentillae rhizoma | Köhler |
| Кукурузные рыльца | *Zea mays* | 8 / 2 (1 OCR) | Maydis stigma | Köhler |
| Фиалка трёхцветная | *Viola tricolor* | 6 / 1 (1 OCR) | Violae herba cum flore | Köhler |
| Эвкалипт | *E. viminalis* (РФ) / *E. globulus* (EMA) | 12 / 2 (1 OCR) | Eucalypti folium, **different species**, shown as such | Köhler (*E. globulus*) |
| Берёза (листья) | *Betula pendula* | 6 / 1 | Betulae folium | Thomé |
| Крапива двудомная | *Urtica dioica* | 16 / 6 (2 OCR) | Urticae folium | Thomé |
| Календула | *Calendula officinalis* | 14 / 4 (1 OCR) | Calendulae flos | Thomé |
| Пустырник | *Leonurus cardiaca* | 17 / 6 (3 OCR) | Leonuri cardiacae herba | Thomé |
| Зверобой | *Hypericum perforatum* | 17 / 6 (4 OCR) | Hyperici herba | **needed** (Lindman / Sturm) |
| Толокнянка | *Arctostaphylos uva-ursi* | 14 / 5 (1 OCR) | Uvae ursi folium | **needed** |
| Хвощ полевой | *Equisetum arvense* | 12 / 3 (2 OCR) | Equiseti herba | **needed** |
| Чистотел | *Chelidonium majus* | 13 / 4 (2 OCR) | **public statement**, negative (liver toxicity) | Thomé |

Notes on the list:

- Chamomile, St John's wort, senna, frangula, celandine and liquorice are included **because** they carry real
  warnings: hepatotoxicity, interactions with contraceptives and anticoagulants, laxative abuse, hypertension.
  This is the safety value of the book.
- Left out on purpose:
  - Rose hip: EMA has no rose-hip monograph; Rosae flos is the petals.
  - Kelp: EMA's Fucus is a different genus.
  - Coltsfoot and plantain: no matching EMA monograph. Coltsfoot contains pyrrolizidine alkaloids, a later
    safety chapter.
  - Thyme: ГРЛС registers *T. serpyllum*, while EMA covers *T. vulgaris*.
- Species mismatches are never silently merged. The chapter shows the ГРЛС species and the EMA species
  separately.

## 4. Data shape

Raw, then prepared, then generated. Nothing is hand-edited in the pack.

```text
data/raw/herbal/ema/<slug>/{monograph,assessment-report}.pdf   + sha256, fetchedAt, EMA "Last updated"
data/raw/herbal/plates/<commons-file>.jpg                       + Commons page, licence, book, plate no.
data/raw/herbal/duke/                                           CC0 raw tables (data.gov archive)
data/raw/herbal/gf15/                                           ОФС «Настои и отвары», «Настойки», «Экстракты»
ГРЛС PDFs: already in data/raw/grls-instructions-active/pdf (reused by checksum)

content/herbal/plants.yaml   (authored, reviewed by hand, the only manual input)
  - id: matricaria-chamomilla
    ru: Ромашка аптечная
    latin: Matricaria chamomilla L.
    family: Asteraceae
    part: { ru: цветки, la: flos }
    grls: { inn: "Ромашки аптечной цветки", representative: "ЛП-№(012192)-(РГ-RU)" }
    ema:  { slug: matricariae-flos, species: "Matricaria recutita L." }
    plate: { source: kohler, file: "File:Matricaria recutita - Köhler–s Medizinal-Pflanzen-091.jpg" }
```

One Markdown chapter per plant (`herbal.plant.<id>`). Every block keeps its `localmed:source` marker: ГРЛС page and
bbox, EMA page, Duke row id.

```text
front matter metadata:
  latin, family, partUsed, navigationAliases (ru names, latin, drug name)
  groups: from the ГРЛС фармакотерапевтическая группа («седативное», «отхаркивающее», …)
  plate: { imageRef, thumbDataUrl (~8 KB), source, licence }
  brew: { method, herbG, waterMl, minutes, servingsPerDay, sourceRef }  # numbers copied, not computed
  limits: { minAgeRu, minAgeEma, pregnancy, lactation, maxDurationDays, sourceRefs }
  evidence: { emaUse: traditional|well-established|public-statement, emaUpdated }
  rightsStatus per layer, requiresReview: true

sections:
  # Как заварить              ГРЛС «Способ применения и дозы», verbatim
  # Кому нельзя                ГРЛС contraindications + children/pregnancy + EMA limits
  # Действие и компоненты      constituent → action rows, evidence level, source
  # Показания                  ГРЛС, then EMA (traditional / well-established marked)
  # Побочное действие и взаимодействия
  # Сырьё и описание           ГРЛС «Описание» (what the dried material looks like)
  # Источники                  small text, last
```

The constituent → effect rows are a **separate draft artifact** (`content/herbal/constituents.<id>.yaml`). Each row
holds an exact quote and page from the EMA assessment report, or a Duke row id. Rows have status `proposed` and an
evidence level: clinical, animal, in vitro or traditional. Duke rows are filtered to compounds the ГРЛС or EMA text
names, so the lab-only activity lists do not swamp the chapter. In the app this block carries one «черновик» badge.

Brewing numbers come from ГРЛС text only. The app never derives a dose. EMA posology is shown next to it as the
European figure.

Two general chapters come from ГФ XV: «Как приготовить настой / отвар / настойку». These are the
herb-only-situation recipes: ratios, temperatures and shelf life.

## 5. Modules and download

| Module | Contents | Size (estimate) | Offered |
| --- | --- | --- | --- |
| `minimed.reference.herbal` (`kind: reference`, collection `herbal`, `releaseState: preview`) | 30 chapters + 2 ГФ chapters, FTS, thumbnails in metadata | ~1–2 MB gz | in «Скачать всё» and at the Травник entry |
| `minimed.reference.herbal.plates` | 30 plates as one STORED ZIP `source-assets` (JPEG ~1600 px, ≤15 % loss) | ~5–8 MB | separately, per the image-pack rule; offered right on the Травник screen («Иллюстрации, 6 МБ») |

- Both modules are small enough to commit under `apps/app/public/content/modules/`, as feeding and diets are. That
  means no new mirror family and no `artifact-url.ts` rule for the pilot.
- No core rebuild in the pilot: chapters become searchable once installed, as feeding is. Core pointers
  («ромашка» → «Травник — скачать») are a follow-up with the next core release.
- Publication: owner decision recorded in `REFERENCE_SOURCE_POLICY.md` (`experimental-preview`,
  `requiresReview: true`), like the Krasota decision.

## 6. Layout (AGENTS.md interface rules)

**Список («Травник»).** Header row: ‹ title, «?», search icon.

- One search field, then a grid of plate thumbnails: Russian name plus italic Latin.
- Group chips across the top: седативные, отхаркивающие, желчегонные, слабительные, мочегонные, вяжущие. They come
  from the ГРЛС фармакотерапевтическая группа.
- Without the plates module, the thumbnails from metadata show anyway. One quiet row offers «Иллюстрации — скачать».

**Chapter, first 375×812 screen.**

1. Plate as the hero (tap to enlarge), then the name, Latin name and family on one line, then group chips.
2. **«Как заварить»** cell: herb g → water ml → minutes → times a day, as icons and numbers. Tap for the verbatim
   ГРЛС recipe.
3. **«Кому нельзя»** row: icon chips for the age limit, pregnancy, lactation, the conditions and maximum duration.
   Red when the EMA document is a negative public statement (celandine).

**Below.**

- «Действие и компоненты»: constituent → action rows with a small evidence dot (clinical / animal / lab /
  traditional).
- Then Показания, Побочное и взаимодействия, Сырьё.

**Reference data last.**

- Small text at the bottom: ГРЛС registration number, EMA monograph and date, plate source.
- Under «?»: how to read the evidence levels, the self-education note, and that ГРЛС numbers are for the
  registered product.

**Reuse.**

- `ConditionCatalogView` (grid, search, metadata filter) for the list.
- `OfficialDocumentReader` for the chapter, with a parameterised `ReaderHero`.
- `PreviewableImage` for zoom.
- The plate resolver generalises the Allmed one (`medication-packaging-images.ts`): module id plus path prefix taken
  from the document metadata, not hard-coded.
- New source type `herbal_monograph` with its own search scope, so herbs do not appear under «Клинические
  рекомендации».

## 7. Steps

1. `plants.yaml` for the 30 plants. Fetch the EMA PDFs, plates and Duke archive into `data/raw/herbal/` with
   checksums. Fetch the ГФ XV ОФС for infusions and tinctures.
2. Pick the representative ГРЛС instruction per plant: a text layer before OCR, then the newest edition. OCR the
   4 plants whose only texts are OCR.
3. `prepare-herbal` (Python, `tools/ingest`): ГРЛС sections → chapters. Extract the EMA posology and limits as
   quoted fields. Build the constituent draft rows with quotes. Run `medbase lint`.
4. Build both modules, add catalog entries and the `collection_herbal` label.
5. App:
   - generic plate resolver;
   - Травник list and route;
   - chapter hero and «Как заварить» / «Кому нельзя» cells, rendered from metadata;
   - search scope;
   - download offer.
6. Checks: `bun run check / typecheck / test / build`, `python:check`. Then a browser run at 375×812, then a Sonnet
   QA pass as a doctor.
7. `CURRENT_STATE.md` and the source-policy decision entry.

## 8. Open questions for the owner

1. **EMA text is English.** Options:
   - (a) Russian numbers and limits as structured fields, with the original English quote on tap;
   - (b) also a machine translation of the EMA sections, marked «перевод, черновик»;
   - (c) English as is.
2. Missing plates for St John's wort, bearberry and horsetail: search Lindman (*Bilder ur Nordens Flora*, public
   domain) and Sturm. Or replace those 3 plants with ones Köhler covers, such as hops, caraway or elder (their ГРЛС
   texts are not collected yet).
3. Field identification (fresh plant, look-alikes such as hemlock vs. yarrow and wild carrot) is **not in any of
   these sources**. It needs a separate botanical source, or it stays out of the pilot.
