from __future__ import annotations

import pytest

from localmed_ingest.specialist_journal_reference import (
    definition_label,
    definition_probes,
    source_units,
)


def test_inline_citations_and_emphasis_stay_in_one_source_run() -> None:
    html = '<div>Синдром <b>примера</b> — синтетическое описание с оговоркой [<a>3</a>, <a>4</a>].</div>'
    units, _ = source_units(html, '#tabs-2')
    assert len(units) == 1
    assert units[0].body == 'Синдром примера — синтетическое описание с оговоркой [3, 4].'
    assert units[0].definitions[0][0] == 'Синдром примера'


def test_plain_source_prose_is_not_split_at_reference_links() -> None:
    body = 'Длинный исходный контекст. ' * 60
    html = '<div>' + body + 'Признак альфа характеризуется особенностью [<a>12</a>]. Конец.</div>'
    units, _ = source_units(html, '#tabs-2')
    assert len(units) == 1
    assert '[12]' in units[0].body
    assert any(label == 'Признак альфа' for label, _ in units[0].definitions)
    assert not any(unit.body == '12' for unit in units)


def test_nested_block_elements_still_have_individual_ordered_units() -> None:
    units, _ = source_units('<div>Перед <b>разделом</b><h3>Раздел</h3><p>Первый.</p><p>Второй.</p></div>', '#tabs-2')
    assert [unit.body for unit in units] == ['Перед разделом', 'Раздел', 'Первый.', 'Второй.']
    assert units[-1].headings == ('Раздел',)


@pytest.mark.parametrize('value', [
    'Диагностика отличается сложностями. Во-первых, ОКС проявляется болью',
    'Источником инфекции являются дети. Пути передачи — разные',
    'Патогенез. Вирус характеризуется особенностью',
    'Абдоминальная форма ОКС чаще проявляется так',
    'ОКС в возрасте до 30 лет характеризуется особенностью',
    'Наличие изменений — характеристика обследования',
    'Настоящий этап изучения СВД характеризуется особенностями',
    'Цель вестибулярной реабилитации — восстановление',
    'Длительность заболевания — характеристика',
    'Психолингвисты определяют две основные области исследований — ...',
])
def test_observed_nonterm_shapes_are_not_active_names(value: str) -> None:
    assert definition_label(value) is None


def test_explicit_symptom_list_lead_is_a_source_candidate_not_invented_definition() -> None:
    assert definition_probes('Синдром примера включает следующие симптомы:') == [
        ('Синдром примера', 'Синдром примера включает следующие симптомы:')
    ]
