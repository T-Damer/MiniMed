# Ambulatory corpus v1 (участок / вызов)

Goal: offline handbook — short answer from search → open full source. KR first;
literature fills gaps and links back. No LLM rewrite of source claims.

## Extractor

| Input | Tool |
|---|---|
| Text-layer PDF, DOCX, XLSX | [anydoc](https://github.com/firecrawl/anydoc) → Markdown |
| Scanned / empty text layer | macOS Vision → dots.ocr if Vision fails |
| Broken Cyrillic layer | existing `medbase prepare` Tesseract path |

anydoc does **not** OCR. Scanned books stay on the Vision/dots ladder.

## Selection rule

1. Official KR present for disease → keep KR primary; book chunks as `literature`
   supplement with provenance link.
2. No KR → take disease sections from literature into the pack fully (still sourced).
3. Whole books also enter FTS as readable documents (full open-in-reader path).
4. Coarse diagnosis facets (age, sex, symptoms, treatment tried) are a **later** pass
   on prepared Markdown — not a blocker for full-text search.

## Priority sources (curated)

Order = extract first.

| # | Path | Mode | Notes |
|---|---|---|---|
| 1 | `Med/ФП/posobie_po_FP.pdf` | anydoc | Pediatrics base — first |
| 2 | `Med/ПДБ/ПДБМетодичка_less.pdf` | anydoc | Propedeutics / exam structure |
| 3 | `Med/ПДБ/pochivalov-_db_uchebnik.pdf` | anydoc | DB textbook |
| 4 | `Med/Инфекции/Infektsii_v_tablitsakh_ot_dr_Elizarik.pdf` | anydoc | Compact infection tables |
| 5 | `Med/Инфекции/Differentsialnaya_diagnostika_infektsionnykh_bolezney_TABLITsA.pdf` | anydoc | DD tables |
| 6 | `Med/Инфекции/Fiziologicheskie_konstanty_u_detei_774.pdf` | anydoc | Pediatric constants |
| 7 | `Med/Инфекции/Инфекции-Чернов-Батищева.pdf` | anydoc | Infections course |
| 8 | `Med/Инфекции/Yuschuk_…_Natsionalnoe_rukovodstvo_3-e_izdanie.pdf` | anydoc | Large NR — later if size hurts |
| 9 | `Med/КлинФарма/okonchatelny_SR_pedfak_KF.pdf` | anydoc | Clinical pharma SR |
| 10 | `Med/ЛОР/ЛОР_Богомильский.pdf` | **OCR** (anydoc: no extractable text) | ENT — PyMuPDF sees layer; use Vision |
| 11 | `Med/Неврология(НЕРВЫ)/Литература/Nevrologia_Uchebnoe_posobie_dlya_studentov.pdf` | anydoc ✅ | Neuro |
| 12 | `Med/Урология/urologiya.pdf` | anydoc ✅ | Urology base |
| 13 | `Med/ФТ(ТФ)(ГТ)(ТГ)/Книги/ВнутренниеБолезниМоисеевТ2.pdf` | anydoc ✅ | Moiseev T2 |
| 14 | `Med/ФТ(ТФ)(ГТ)(ТГ)/Книги/ВнутренниеБолезниМоисеевТ1.pdf` | weak/OCR | T1 weak text layer |
| 15 | `Med/Фтиза/Фтиз_Таблица.xlsx` | anydoc ✅ | Short phthisiology base |
| 16 | `Med/Фтиза/ФтизаЛозовская.pdf` | anydoc ✅ | Expanded phthisiology |
| 17 | `Med/Психиатрия/metodichka_kafedralnaya_po_chastnoy_psikhe.docx` | anydoc ✅ | Psych base + terms |
| 18 | `Med/Психиатрия/obschaya_psikhopatologia_2.pdf` | **OCR** | General psychopathology |
| 19 | `Med/Травма/…/Котельников…2021_compressed.pdf` | **OCR** | Trauma — large scan |
| 20 | `Med/Нео/Литература/Володин-НЕОНАТОЛОГИЯ-Национальное-руководство.pdf` | **OCR** (anydoc Mixed) | Neo norms / transitional |
| 21 | `Med/Нео/К занятиям/Неврологический_осмотр_новорожденного.docx` | anydoc ✅ | Neo exam |
| 22 | `Med/Нео/Литература/Шабалов_Нео_2016.pdf` | **OCR** | Only transitional + norms chapters |

### Extract status (2026-08-05)

15/17 text-layer sources → `data/intermediate/ambulatory-v1/` via `scripts/anydoc_batch.py`.
Fails needing OCR: `lor.bogomilsky`, `neo.volodin_nr`.

### Neo filter

From neonatology books keep only: transitional states of the newborn, reference
ranges/norms, red flags for primary care / house call. Drop NICU protocols unless
they change site management.

### Skip for v1

Exam tickets, Moodle test dumps, lecture slide decks, pure homework — unless they
are the only source of a compact table.

## Also worth adding (ambulatory gaps)

| Path | Why |
|---|---|
| `Med/Дерма/` main textbook if text-layer | Skin is high site volume |
| `Med/Офтальм/` short handbook | Eye red flags |
| `Med/Психиатрия` scales already in `content/reference-rf-pilot` | Keep; link from psych MD |
| Official KR JSON already in pilot modules | Always outrank textbook on same disease |
| `Med/Фтиза/КР_СпонтанныйПневмоторакс.pdf` | KR-shaped; prepare via medbase |

## Pipeline

```text
curated paths
  → anydoc (text) | vision/dots (scan)
  → data/intermediate/ambulatory-v1/<id>.md + provenance sidecar
  → medbase lint/build (or private prepare registry)
  → core edition chunk
```

Full-text search of whole books ships first. Symptom/age facets for
«у ребенка X симптомы Y,Z» are a second pass over the same Markdown.
