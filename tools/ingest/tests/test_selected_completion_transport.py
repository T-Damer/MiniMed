from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from localmed_ingest.clinic_definition_completions import fetch_public, verify_excerpt


def test_inspected_manual_uses_ascii_http_path_without_changing_source_authority() -> None:
    response = MagicMock()
    response.status = 200
    response.read.return_value = b"<h1>Source</h1>"
    response.getheader.return_value = "text/html"
    connection = MagicMock()
    connection.getresponse.return_value = response
    with patch("http.client.HTTPSConnection", return_value=connection) as factory:
        status, _, _ = fetch_public("https://www.msdmanuals.com/ru/professional/нефрология")
    assert status == 200
    factory.assert_called_once_with("www.msdmanuals.com", timeout=20)
    sent_path = connection.request.call_args.args[1]
    assert isinstance(sent_path, str)
    assert sent_path.isascii() and "%D0%BD" in sent_path
    connection.close.assert_called_once()


@pytest.mark.parametrize(
    "url",
    [
        "https://www.msdmanuals.com.evil.example/ru/",
        "https://user:password@www.msdmanuals.com/ru/",
        "http://www.msdmanuals.com/ru/",
        "https://www.msdmanuals.com/ru/?token=secret",
        "https://www.msdmanuals.com:444/ru/",
    ],
)
def test_manual_does_not_relax_authority_boundary(url: str) -> None:
    with (
        patch("http.client.HTTPSConnection") as factory,
        pytest.raises(ValueError, match="allowlist"),
    ):
        fetch_public(url)
    factory.assert_not_called()


def test_source_thresholds_and_author_remain_exact_not_rewritten() -> None:
    excerpt = "Тестовый показатель < 136 единиц."
    raw = f"<h1>Источник</h1><p>Проверенный автор</p><p>{excerpt.replace('<', '&lt;')}</p>".encode()
    result = verify_excerpt(raw, excerpt, "Проверенный автор")
    assert result["end"] == len(excerpt)
    with pytest.raises(ValueError, match="absent"):
        verify_excerpt(raw, excerpt.replace("136", "135"), "Проверенный автор")
    with pytest.raises(ValueError, match="author"):
        verify_excerpt(raw, excerpt, "Другой автор")
