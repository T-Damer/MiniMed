"""Requirement tables read without their label column: which lines are painted, and the rows put back."""

from localmed_ingest.legal_texts import Block, label_specialty_rows
from localmed_ingest.legal_unlabel import label_boxes, row_labels


def line(text: str, x: float, y: float, h: float = 0.019) -> dict[str, object]:
    return {"text": text, "bbox": [x, y, 0.1, h]}


def test_only_the_known_label_words_at_the_left_edge_are_painted() -> None:
    lines = [
        line("Уровень", 0.096, 0.86),
        line("профессионального из специальностей: «Лечебное дело»", 0.096, 0.84),
        line("образования", 0.096, 0.82),
        line("Высшее образование", 0.317, 0.86),
        line("Специальность «Гастроэнтерология»", 0.336, 0.892),
        line("Примечание", 0.09, 0.5),
    ]
    boxes, foreign = label_boxes(lines)  # type: ignore[arg-type]
    assert len(boxes) == 3
    assert foreign == ["Примечание"]


def test_rows_are_labelled_by_their_order_and_a_misfit_block_is_refused() -> None:
    paragraphs = [
        "Высшее образование – специалитет по специальности «Стоматология»",
        "Подготовка в ординатуре по специальности «Ортодонтия»",
        "Повышение квалификации не реже одного раза в 5 лет в течение всей трудовой деятельности",
        "Врач-ортодонт; заведующий (начальник) структурного подразделения",
    ]
    assert row_labels(paragraphs) == [
        "Уровень профессионального образования",
        "Уровень профессионального образования",
        "Дополнительное профессиональное образование",
        "Должности",
    ]
    assert row_labels(paragraphs[:2]) is None
    assert row_labels(["Высшее образование", "Врач", "Врач-генетик"]) is None


def test_the_labels_go_on_the_paragraphs_of_each_specialty_block() -> None:
    blocks = [
        Block("heading", "Специальность «Ортодонтия»", 1, 3),
        Block("paragraph", "(сохраняется до 1 сентября 2023 г.)", 1),
        Block("paragraph", "Высшее образование – специалитет по специальности «Стоматология»", 1),
        Block("paragraph", "Повышение квалификации не реже одного раза в 5 лет", 1),
        Block("paragraph", "Врач-ортодонт", 1),
        Block("heading", "Специальность «Терапия»", 1, 3),
        Block("paragraph", "Высшее образование", 1),
    ]
    unfit = label_specialty_rows(blocks)
    assert unfit == ["Специальность «Терапия»"]
    assert blocks[1].text.startswith("(сохраняется")
    assert blocks[2].text.startswith("Уровень профессионального образования. Высшее")
    assert blocks[3].text.startswith("Дополнительное профессиональное образование. Повышение")
    assert blocks[4].text == "Должности. Врач-ортодонт"
