from __future__ import annotations

import copy

import pytest

from localmed_ingest.definition_reference_pack import obj, seq
from localmed_ingest.specialist_journal_admission import admit_article, candidate_issue
from localmed_ingest.specialist_journal_reference import project_article
from test_specialist_journal_reference import HTML, snapshot


@pytest.mark.parametrize('label', [
    'Синдром примера', 'Гуморальный иммунный ответ', 'Симптомокомплекс',
    'Фибрилляция предсердий (ФП)', 'Ганглионевралгическая форма (zona fruste)',
    'Мерцательная аритмия, или фибрилляция предсердий',
    '2. Классификация мерцательной аритмии',
    'Соматоформное расстройство', 'Акцентуация характера',
])
def test_source_noun_labels_remain_candidates(label: str) -> None:
    assert candidate_issue(label) is None


@pytest.mark.parametrize('label', [
    'Достаточно широко используют близкое понятие',
    'Синдром, как и симптом', 'Клинически это', 'Абортивный',
    'У больных с удаленными миндалинами реакция ткани',
    'Современная психиатрическая практика нуждается в показателях',
    'Больным с тяжелым, а у иммунокомпрометированных',
    'Следствие расширения международного сотрудничества',
    'Существенные различия существуют у двух специальностей',
    'Следующий тип', 'Большинство считает, что основной фактор',
    'Таким образом, основной механизм', 'Естественное следствие разнообразия',
])
def test_clause_labels_go_to_review_not_term_count(label: str) -> None:
    assert candidate_issue(label) is not None


def test_all_source_paragraphs_and_metadata_survive_label_rejection() -> None:
    html = HTML.replace(
        '<h3>Заключение</h3>',
        '<p>Следующий тип — условное продолжение исходного обсуждения.</p>'
        '<h3>Заключение</h3>',
    )
    original = project_article(snapshot(html))
    untouched = copy.deepcopy(original)
    selected, report = admit_article(original)
    assert original == untouched
    assert selected['blocks'] == original['blocks']
    assert selected['sources'] == original['sources']
    candidates = [obj(v) for v in seq(original['terms'], 1000)]
    kept = [obj(v) for v in seq(selected['terms'], 1000)]
    assert any(t['title'] == 'Следующий тип' for t in candidates)
    assert not any(t['title'] == 'Следующий тип' for t in kept)
    assert all(t in candidates for t in kept)
    assert obj(report['counts'])['articleOverviews'] == 1
    assert obj(report['counts'])['excludedCandidateLabels'] == 1
    assert any('Следующий тип' in str(obj(b)['text']) for b in seq(selected['blocks'], 1000))
    assert any(obj(b).get('tables') for b in seq(selected['blocks'], 1000))
    source = obj(seq(selected['sources'], 10)[0])
    assert source['license'] == 'CC-BY-NC-SA-4.0'
    assert source['nonCommercialOnly'] is True
    assert source['publicationDate'] == '2017-12-15'
    assert source['releaseEligible'] is False


def test_distinct_same_title_source_positions_are_not_silently_merged() -> None:
    html = HTML.replace(
        '<h3>Заключение</h3>',
        '<p>Синдром примера — другая авторская формулировка, оставленная отдельно.</p>'
        '<h3>Заключение</h3>',
    )
    original = project_article(snapshot(html))
    selected, _ = admit_article(original)
    matches = [obj(t) for t in seq(selected['terms'], 1000) if obj(t)['title'] == 'Синдром примера']
    assert len(matches) >= 3
    assert len({str(t['id']) for t in matches}) == len(matches)


@pytest.mark.parametrize(('field', 'value'), [('start', -1), ('start', True), ('end', 999999), ('block', 999)])
def test_broken_label_source_ranges_are_rejected(field: str, value: object) -> None:
    original = project_article(snapshot())
    candidate = obj(seq(original['terms'], 1000)[1])
    obj(candidate['labelEvidence'])[field] = value
    with pytest.raises(ValueError):
        admit_article(original)


def test_label_must_be_literal_source_text() -> None:
    original = project_article(snapshot())
    obj(seq(original['terms'], 1000)[1])['title'] = 'Invented replacement'
    with pytest.raises(ValueError, match='source span'):
        admit_article(original)


@pytest.mark.parametrize(('field', 'value'), [
    ('releaseEligible', True), ('license', 'unknown'), ('sourceType', 'wikipedia'),
    ('publicationDate', ''),
])
def test_admission_does_not_promote_source_or_guess_licensing(field: str, value: object) -> None:
    original = project_article(snapshot())
    obj(seq(original['sources'], 10)[0])[field] = value
    with pytest.raises(ValueError):
        admit_article(original)


def test_overview_is_required_and_not_counted_as_definition() -> None:
    original = project_article(snapshot())
    original['terms'] = [seq(original['terms'], 1000)[0]]
    selected, report = admit_article(original)
    assert len(seq(selected['terms'], 1000)) == 1
    assert obj(report['counts']).get('definitionCandidates', 0) == 0
    assert obj(report['counts'])['articleOverviews'] == 1
    original['terms'] = []
    with pytest.raises(ValueError):
        admit_article(original)
