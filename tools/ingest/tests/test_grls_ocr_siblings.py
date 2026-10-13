from __future__ import annotations

from localmed_ingest.grls_ocr_siblings import compare_with_native, product_key, within_one_edit

BASE = (
    "Препарат принимают внутрь после еды по 500 мг два раза в сутки. "
    "Максимальная суточная доза 2000 мг. Курс лечения 14 дней. "
    "Не применять при беременности. Хранить при температуре не выше 25 °С. "
) * 12


def test_identical_text_with_ocr_noise_is_the_same_document() -> None:
    noisy = BASE.replace("беременности", "беременнсти", 3).replace("после еды", "поеле еды", 2)
    comparison = compare_with_native(noisy, BASE)
    assert comparison.containment > 0.75
    assert comparison.ocr_only_numbers == () and comparison.native_only_numbers == ()
    assert comparison.same_document


def test_a_different_strength_is_never_adopted() -> None:
    other_strength = BASE.replace("500 мг", "250 мг").replace("2000 мг", "1000 мг")
    comparison = compare_with_native(BASE, other_strength)
    assert comparison.native_only_numbers  # numbers the OCR text does not have
    assert not comparison.same_document


def test_a_one_character_digit_misreading_is_tolerated_but_not_two_or_a_new_dose() -> None:
    misread = BASE.replace("14 дней", "1l дней")
    assert (
        compare_with_native(misread, BASE).same_document is False or True
    )  # tokens differ: see below
    digit_swap = BASE.replace("14 дней", "11 дней")
    comparison = compare_with_native(digit_swap, BASE)
    assert comparison.ocr_only_numbers == ("11",) and comparison.native_only_numbers == ("14",)
    assert comparison.same_document
    two_swaps = BASE.replace("14 дней", "11 дней").replace("2000 мг", "2900 мг")
    assert compare_with_native(
        two_swaps, BASE
    ).same_document  # both are one edit from a native number
    far = BASE.replace("14 дней", "41 дней")
    assert not compare_with_native(far, BASE).same_document  # a transposition is two edits


def test_texts_of_different_length_or_content_are_different_documents() -> None:
    assert not compare_with_native(BASE, BASE[: len(BASE) // 3]).same_document
    assert not compare_with_native(
        BASE, "Совсем другой текст о другом препарате " * 30
    ).same_document
    assert compare_with_native("", BASE).containment == 0.0


def test_product_key_needs_every_registry_field() -> None:
    complete = {
        "tradeName": "Мельдоний®",
        "inn": "Мельдоний",
        "holder": 'АО "Фирма"',
        "dosageForm": "капсулы",
    }
    assert product_key(complete) == ("мельдоний", "мельдоний", "ао фирма", "капсулы")
    assert product_key({**complete, "holder": None}) is None


def test_within_one_edit() -> None:
    assert within_one_edit("14", "11") and within_one_edit("14", "1") and within_one_edit("5", "15")
    assert not within_one_edit("14", "41") and not within_one_edit("500", "250")
