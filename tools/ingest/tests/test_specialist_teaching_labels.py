from __future__ import annotations

import copy

import pytest

from localmed_ingest.definition_reference_pack import obj, seq
from localmed_ingest.specialist_journal_admission import admit_article, candidate_issue
from localmed_ingest.specialist_journal_reference import project_article
from test_specialist_journal_reference import HTML, snapshot


@pytest.mark.parametrize(
    "title",
    [
        "Первое",
        "Второе",
        "Первая стадия",
        "Вторая стадия",
        "Третья стадия",
        "псевдокоронарная",
        "декомпенсационная",
        "аритмическая",
        "смешанная",
        "обязательные",
        "рекомендуемые",
        "факультативные",
        "Метод исследования",
        "Инвазивный метод исследования",
        "Клиническая картина заболевания",
        "Важное преимущество теста",
        "Секреция кортизола происходит по циркадному ритму",
        "Скорее самоповреждающее поведение",
        "Деперсонализационные расстройства отмечаются на фоне интоксикации",
        "Передняя доля гипофиза регулирует репродуктивную систему",
        "Существует две формы субъединиц",
        "Такое течение инфекции в литературе описывается как вариант",
        "Новое лечебное направление в радиологии",
        "Новая эра в применении метода",
        "Основные задачи этапа стабилизации",
        "Основные задача этапа стабилизации",
        "Следующим шагом для исследователей стал метод",
        "Непрямым методом определения показателя",
    ],
)
def test_narrative_or_parentless_labels_are_not_standalone_terms(title: str) -> None:
    assert candidate_issue(title) is not None


@pytest.mark.parametrize(
    "title",
    [
        "Псевдокоронарная форма миокардита",
        "Первая стадия хронической болезни почек",
        "Методы диагностики уросепсиса",
        "Классификация симптомов нижних мочевых путей",
        "Мальформация Киари 1 типа",
        "Деперсонализация",
        "ОАЭ",
        "Синдром гиперактивного мочевого пузыря",
        "Ингибин",
        "Фрагментация ДНК",
        "Фактор роста нервов (Nerve Growth Factor, NGF)",
        "Гуморальный иммунный ответ",
        "Лёгкое",
        "Новое коронавирусное заболевание",
    ],
)
def test_scoped_labels_are_not_replaced_or_rejected_by_generic_adjective_rules(title: str) -> None:
    assert candidate_issue(title) is None


def test_dropped_labels_keep_all_source_text_tables_and_existing_identities() -> None:
    inserted = "".join(
        f"<p>{title} — продолжение синтетического исходного описания.</p>"
        for title in ("Первое", "Вторая стадия", "обязательные", "Метод исследования")
    )
    raw = project_article(
        snapshot(HTML.replace("<h3>Заключение</h3>", inserted + "<h3>Заключение</h3>"))
    )
    original = copy.deepcopy(raw)
    admitted, report = admit_article(raw)
    assert raw == original
    assert admitted["blocks"] == original["blocks"]
    assert admitted["sources"] == original["sources"]
    old = [obj(v) for v in seq(original["terms"], 1000)]
    kept = [obj(v) for v in seq(admitted["terms"], 1000)]
    removed = [obj(v) for v in seq(report["excludedCandidates"], 1000)]
    assert {"Первое", "Вторая стадия", "обязательные", "Метод исследования"} <= {
        str(t["title"]) for t in removed
    }
    assert all(term in old for term in kept)
    assert all(
        term["title"] not in {"Первое", "Вторая стадия", "обязательные", "Метод исследования"}
        for term in kept
    )
    assert any(
        obj(term).get("recordRole") == "article-overview-not-independent-term" for term in kept
    )
    assert any("Вторая стадия" in str(obj(b)["text"]) for b in seq(admitted["blocks"], 1000))
