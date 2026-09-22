from __future__ import annotations

import json
from pathlib import Path

from localmed_ingest.wikipedia_definitions import obj
from localmed_ingest.wikipedia_scope import select_paths


def test_actual_policy_preserves_medical_disciplines_and_excludes_people() -> None:
    root = Path(__file__).resolve().parents[3]
    policy = obj(json.loads(
        (root / 'content/definition-drafts/ruwiki-scope-2026.09.22.json').read_bytes()
    ))
    categories: dict[str, list[object]] = {
        'Категория:Медицина': [
            {'pageid': 100, 'ns': 14, 'title': 'Категория:Гистология'},
            {'pageid': 101, 'ns': 14, 'title': 'Категория:Гастроэнтерология'},
            {'pageid': 102, 'ns': 14, 'title': 'Категория:Гистологи'},
            {'pageid': 103, 'ns': 14, 'title': 'Категория:Гастроэнтерологи'},
            {'pageid': 104, 'ns': 14, 'title': 'Категория:Патогистология'},
            {'pageid': 105, 'ns': 14, 'title': 'Категория:Рука в геральдике'},
        ],
        'Категория:Гистология': [{'pageid': 1, 'ns': 0, 'title': 'Ткань'}],
        'Категория:Гастроэнтерология': [{'pageid': 2, 'ns': 0, 'title': 'Пищеварение'}],
        'Категория:Гистологи': [{'pageid': 3, 'ns': 0, 'title': 'Первый автор'}],
        'Категория:Гастроэнтерологи': [{'pageid': 4, 'ns': 0, 'title': 'Второй автор'}],
        'Категория:Патогистология': [{'pageid': 5, 'ns': 0, 'title': 'Изменение ткани'}],
        'Категория:Рука в геральдике': [{'pageid': 6, 'ns': 0, 'title': 'Герб'}],
    }
    selection: dict[str, object] = {
        'seeds': [{'category': 'Категория:Медицина', 'family': 'medical', 'depth': 1}]
    }
    pages, report = select_paths(categories, selection, policy)
    assert set(pages) == {1, 2, 5}
    assert report['unfetchedCategories'] == []
    assert report['excludedCategories'] == [
        'Категория:Гастроэнтерологи', 'Категория:Гистологи', 'Категория:Рука в геральдике',
    ]
