from __future__ import annotations

from pathlib import Path

import yaml

PATH = Path("content/pilot-rf/knowledge.yaml")


def load() -> dict:
    value = yaml.safe_load(PATH.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit("knowledge.yaml must be a mapping")
    return value


def add_unique(items: list[dict], item: dict) -> None:
    ids = {value.get("id") for value in items}
    if item["id"] not in ids:
        items.append(item)


def evidence(document: str, version: str, section: str, chunk: str, quote: str, url: str, record: str) -> list[dict]:
    return [{
        "documentId": document,
        "documentVersionId": f"{document}@{version}",
        "sectionId": section,
        "chunkId": chunk,
        "quote": quote,
        "sourceLocator": {"url": url, "recordId": record},
    }]


def main() -> None:
    data = load()
    entities = data.setdefault("entities", [])
    facts = data.setdefault("facts", [])
    links = data.setdefault("documentLinks", [])
    tasks = data.setdefault("reviewTasks", [])

    records = [
        {
            "slug": "amoxicillin-clavulanate-suspension-400-57",
            "entity": "medication.amoxicillin-clavulanate.suspension.400mg-57mg-5ml",
            "canonical": "Амоксициллин + клавулановая кислота 400 мг + 57 мг/5 мл, суспензия",
            "names": [
                {"name": "Амоксициллин + клавулановая кислота", "nameType": "inn", "weight": 1.2},
                {"name": "Аугментин", "nameType": "trade-name", "weight": 1.1},
                {"name": "ко-амоксиклав", "nameType": "common-name", "weight": 0.9},
            ],
            "record": "1000045857",
            "registration": "ЛП-№(003017)-(РГ-RU)",
            "inn": "Амоксициллин+[Клавулановая кислота]",
            "form": "порошок для приготовления суспензии для приема внутрь",
            "route": "oral",
            "strength": "400 мг+57 мг/5 мл",
            "pediatric": "formulation-specific-review-required",
            "valid": "2025-04-14",
            "document": "drug.rf.amoxicillin-clavulanate.suspension-400-57",
            "version": "registry-2025-04-14",
            "section": "section.bf6f7c3f7b38950d",
            "chunk": "chunk.5ef6c7113d8f5fdf",
            "url": "https://pots.minzdrav.gov.ru/public_price_limits?page=128&per_page=30",
            "quote": "В государственном реестре предельных отпускных цен присутствует лекарственный препарат «Аугментин»: МНН — амоксициллин+[клавулановая кислота], лекарственная форма — порошок для приготовления суспензии для приема внутрь, дозировка 400 мг+57 мг/5 мл, регистрационное удостоверение ЛП-№(003017)-(РГ-RU). Дата вступления решения в силу — 14 апреля 2025 года.",
            "fact": "В государственном реестре зафиксирована суспензия амоксициллина с клавулановой кислотой 400 мг+57 мг/5 мл с регистрационным удостоверением ЛП-№(003017)-(РГ-RU).",
        },
        {
            "slug": "azithromycin-suspension-200",
            "entity": "medication.azithromycin.suspension.200mg-5ml",
            "canonical": "Азитромицин 200 мг/5 мл, суспензия",
            "names": [
                {"name": "Азитромицин", "nameType": "inn", "weight": 1.2},
                {"name": "Сумамед форте", "nameType": "trade-name", "weight": 1.1},
            ],
            "record": "1000107564",
            "registration": "ЛП-№(001367)-(РГ-RU)",
            "inn": "Азитромицин",
            "form": "порошок для приготовления суспензии для приема внутрь",
            "route": "oral",
            "strength": "200 мг/5 мл",
            "pediatric": "formulation-specific-review-required",
            "valid": "2026-07-03",
            "document": "drug.rf.azithromycin.suspension-200mg-5ml",
            "version": "registry-2026-07-03",
            "section": "section.c0613d93b6cf34a1",
            "chunk": "chunk.7142363f43639b5c",
            "url": "https://pots.minzdrav.gov.ru/public_price_limits?page=20&per_page=30",
            "quote": "В государственном реестре предельных отпускных цен присутствует лекарственный препарат «Сумамед форте»: МНН — азитромицин, лекарственная форма — порошок для приготовления суспензии для приема внутрь, дозировка 200 мг/5 мл, регистрационное удостоверение ЛП-№(001367)-(РГ-RU). Дата вступления решения в силу — 3 июля 2026 года.",
            "fact": "В государственном реестре зафиксирована суспензия азитромицина 200 мг/5 мл с регистрационным удостоверением ЛП-№(001367)-(РГ-RU).",
        },
        {
            "slug": "ceftriaxone-injection-1g",
            "entity": "medication.ceftriaxone.injection.1g",
            "canonical": "Цефтриаксон 1 г, порошок для внутривенного и внутримышечного введения",
            "names": [
                {"name": "Цефтриаксон", "nameType": "inn", "weight": 1.2},
                {"name": "ceftriaxone", "language": "en", "nameType": "inn-latin", "weight": 1.0},
            ],
            "record": "1000135207",
            "registration": "ЛП-№(005496)-(РГ-RU)",
            "inn": "Цефтриаксон",
            "form": "порошок для приготовления раствора для внутривенного и внутримышечного введения",
            "route": "parenteral",
            "strength": "1 г",
            "pediatric": "population-review-required",
            "valid": "2026-07-07",
            "document": "drug.rf.ceftriaxone.injection-1g",
            "version": "registry-2026-07-07",
            "section": "section.0eebcb7adb823156",
            "chunk": "chunk.a0322c4239fad577",
            "url": "https://pots.minzdrav.gov.ru/public_price_limits?page=3456",
            "quote": "В государственном реестре предельных отпускных цен присутствует лекарственный препарат с МНН цефтриаксон: порошок для приготовления раствора для внутривенного и внутримышечного введения, дозировка 1 г, регистрационное удостоверение ЛП-№(005496)-(РГ-RU). Дата вступления решения в силу — 7 июля 2026 года.",
            "fact": "В государственном реестре зафиксирован порошок цефтриаксона 1 г для внутривенного и внутримышечного введения с регистрационным удостоверением ЛП-№(005496)-(РГ-RU).",
        },
        {
            "slug": "oral-rehydration-salts-18-9g",
            "entity": "medication.oral-rehydration-salts.powder.18-9g",
            "canonical": "Декстроза + калия хлорид + натрия хлорид + натрия цитрат, порошок 18,9 г",
            "names": [
                {"name": "Регидрон", "nameType": "trade-name", "weight": 1.1},
                {"name": "оральные регидратационные соли", "nameType": "common-name", "weight": 1.0},
                {"name": "ОРС", "nameType": "abbreviation", "weight": 0.9},
            ],
            "record": "1000120007",
            "registration": "ЛП-№(012750)-(РГ-RU)",
            "inn": "Декстроза+Калия хлорид+Натрия хлорид+Натрия цитрат",
            "form": "порошок для приготовления раствора для приема внутрь",
            "route": "oral",
            "strength": "18,9 г",
            "pediatric": "population-review-required",
            "valid": "2026-02-25",
            "document": "drug.rf.oral-rehydration-salts.powder-18-9g",
            "version": "registry-2026-02-25",
            "section": "section.9ee99f0b0ec736bf",
            "chunk": "chunk.a3db70a869d4b4eb",
            "url": "https://pots.minzdrav.gov.ru/public_price_limits?page=1045",
            "quote": "В государственном реестре предельных отпускных цен присутствует лекарственный препарат «Регидрон»: МНН — декстроза+калия хлорид+натрия хлорид+натрия цитрат, лекарственная форма — порошок для приготовления раствора для приема внутрь, масса пакетика 18,9 г, регистрационное удостоверение ЛП-№(012750)-(РГ-RU). Дата вступления решения в силу — 25 февраля 2026 года.",
            "fact": "В государственном реестре зафиксирован порошок для оральной регидратации 18,9 г с регистрационным удостоверением ЛП-№(012750)-(РГ-RU).",
        },
        {
            "slug": "oseltamivir-capsules-30",
            "entity": "medication.oseltamivir.capsule.30mg",
            "canonical": "Осельтамивир 30 мг, капсулы",
            "names": [
                {"name": "Осельтамивир", "nameType": "inn", "weight": 1.2},
                {"name": "oseltamivir", "language": "en", "nameType": "inn-latin", "weight": 1.0},
            ],
            "record": "1000165168",
            "registration": "ЛП-№(002417)-(РГ-RU)",
            "inn": "Осельтамивир",
            "form": "капсулы",
            "route": "oral",
            "strength": "30 мг",
            "pediatric": "formulation-specific-review-required",
            "valid": "2026-07-08",
            "document": "drug.rf.oseltamivir.capsules-30mg",
            "version": "registry-2026-07-08",
            "section": "section.ccdd5c9136fdc603",
            "chunk": "chunk.bf824f9cc712e695",
            "url": "https://pots.minzdrav.gov.ru/public_price_limits?page=2422&per_page=15",
            "quote": "В государственном реестре предельных отпускных цен присутствует лекарственный препарат с МНН осельтамивир: капсулы 30 мг, регистрационное удостоверение ЛП-№(002417)-(РГ-RU). Дата вступления решения в силу — 8 июля 2026 года.",
            "fact": "В государственном реестре зафиксированы капсулы осельтамивира 30 мг с регистрационным удостоверением ЛП-№(002417)-(РГ-RU).",
        },
    ]

    for record in records:
        add_unique(entities, {
            "id": record["entity"],
            "entityType": "medication",
            "canonicalName": record["canonical"],
            "names": record["names"],
            "externalIds": {
                "grls-price-record": record["record"],
                "ru-registration-number": record["registration"],
            },
            "medication": {
                "conceptLevel": "clinical-drug",
                "inn": record["inn"],
                "dosageForm": record["form"],
                "route": record["route"],
                "strength": record["strength"],
                "registrationNumber": record["registration"],
                "registrationStatus": "present-in-public-price-registry",
                "pediatricStatus": record["pediatric"],
                "metadata": {"sourceReviewedAt": "2026-07-20"},
            },
        })
        add_unique(facts, {
            "id": f"fact.registry.{record['slug']}",
            "entityId": record["entity"],
            "factType": "registration-identity",
            "text": record["fact"],
            "structured": {
                "inn": record["inn"],
                "dosageForm": record["form"],
                "strength": record["strength"],
                "registrationNumber": record["registration"],
                "registryRecordId": record["record"],
            },
            "population": {},
            "approvalStatus": "registry-metadata-only",
            "authorityTier": "official-registry",
            "reviewStatus": "proposed",
            "jurisdiction": "RU",
            "confidence": 1.0,
            "validFrom": record["valid"],
            "evidence": evidence(record["document"], record["version"], record["section"], record["chunk"], record["quote"], record["url"], record["record"]),
        })
        add_unique(links, {
            "id": f"link.{record['slug']}-registry-card",
            "entityId": record["entity"],
            "documentId": record["document"],
            "documentVersionId": f"{record['document']}@{record['version']}",
            "sectionId": record["section"],
            "chunkId": record["chunk"],
            "linkType": "registration-record",
            "weight": 1.0,
            "reviewStatus": "proposed",
        })

    for task in tasks:
        if task.get("id") == "review.registry-drug-pilot":
            task["question"] = "Сверить восемь регистрационных записей с актуальным ГРЛС/ЕСКЛП и подтвердить номера РУ, формы и дозировки перед переводом фактов в reviewed."
            task["missingFields"] = ["current-registration-status", "official-instruction-version", "esklp-smnn-id", "esklp-klp-id"]

    add_unique(tasks, {
        "id": "review.additional-drug-clinical-links",
        "taskType": "clinical-review",
        "question": "Определить по официальным инструкциям и клиническим рекомендациям допустимые связи для ко-амоксиклава, азитромицина, цефтриаксона, оральных регидратационных солей и осельтамивира; регистрационная запись сама по себе не является показанием.",
        "missingFields": ["approved-indications", "age-limits", "weight-specific-regimens", "contraindications", "interactions", "renal-hepatic-adjustment"],
        "priority": 95,
        "status": "open",
        "metadata": {"requestedReviewerRole": "pediatrician-and-clinical-pharmacist"},
    })

    PATH.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=200), encoding="utf-8")


if __name__ == "__main__":
    main()
