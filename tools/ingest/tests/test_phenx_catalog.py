from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import cast
from urllib.request import Request

import pytest

import localmed_ingest.phenx_catalog as pc


def page(protocol_id: str = "121704", language: str = "English") -> bytes:
    return f"""<!doctype html><html><body>
<header><h1>Protocol - Synthetic metadata fixture</h1></header>
<h5>Description</h5><p>Only <b>synthetic</b> metadata &amp; no clinical claims.</p>
<h5>Availability</h5><p>Permission status belongs to this source.</p>
<h5>Protocol</h5><p>UNIMPORTED_QUESTION_PAYLOAD</p>
<h5>Language</h5><p>{language}</p>
<h5>Participants</h5><p>Fictional test population.</p>
<h5>Source</h5><p>Fixture author, version one.</p>
<h5>Protocol ID</h5><p>{protocol_id}</p>
<h5>Variables</h5><p>NOT_A_METADATA_FIELD</p>
</body></html>""".encode()


def test_preserves_identity_source_heading_and_separate_rights() -> None:
    raw = page()
    record = pc.prepare_protocol("121704", raw)
    fields = cast(dict[str, str], record["sourceFields"])
    source = cast(dict[str, object], record["source"])
    rights = cast(dict[str, str], record["rights"])
    assert record["id"] == "phenx.protocol.121704"
    assert record["title"] == "Synthetic metadata fixture"
    assert fields["Description"] == "Only synthetic metadata & no clinical claims."
    assert source["sha256"] == "sha256:" + hashlib.sha256(raw).hexdigest()
    assert rights["instrumentRedistribution"] == "review-required"
    assert "UNIMPORTED_QUESTION_PAYLOAD" not in json.dumps(record)
    assert "NOT_A_METADATA_FIELD" not in json.dumps(record)
    assert record["interactiveDefinition"] is None
    assert record["rfClinicalApplicability"] == "not-verified"


def test_language_and_same_name_do_not_establish_translation_or_equivalence() -> None:
    first = pc.prepare_protocol("121704", page(language="English, Other languages at source"))
    second = pc.prepare_protocol("121705", page("121705", "Russian"))
    assert first["title"] == second["title"]
    assert first["id"] != second["id"]
    assert first["russianForm"] == second["russianForm"] == "not-verified"


@pytest.mark.parametrize("identity", ["../secret", "https://localhost", "00000", "1?token=x"])
def test_rejects_non_protocol_identifiers(identity: str) -> None:
    with pytest.raises(ValueError, match="numeric"):
        pc.prepare_protocol(identity, page())


def test_rejects_wrong_protocol_login_page_and_missing_metadata() -> None:
    with pytest.raises(ValueError, match="identity"):
        pc.prepare_protocol("121705", page())
    with pytest.raises(ValueError, match="login/error/layout"):
        pc.prepare_protocol("121704", b"<h1>Log in</h1><form>Password</form>")
    with pytest.raises(ValueError, match="login/error/layout"):
        pc.prepare_protocol("121704", page().replace(b"<h5>Language</h5>", b"<h5>Changed</h5>"))


def test_rejects_conflicting_fields_and_size_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="Conflicting"):
        pc.prepare_protocol("121704", page() + b"<h5>Language</h5><p>Conflicting locale</p>")
    monkeypatch.setattr(pc, "MAX_SOURCE_BYTES", 20)
    with pytest.raises(ValueError, match="size limit"):
        pc.prepare_protocol("121704", page())


def test_ignores_scripts_without_erasing_visible_protocol_header() -> None:
    raw = page().replace(
        b"</body>",
        b"<script>evil()\n<h5>Language</h5>Other</script></body>",
    )
    record = pc.prepare_protocol("121704", raw)
    assert "evil" not in json.dumps(record)
    assert record["title"] == "Synthetic metadata fixture"


def test_offline_output_is_reproducible_and_does_not_mutate_inputs(tmp_path: Path) -> None:
    source = tmp_path / "input"
    source.mkdir()
    source_path = source / "121704.html"
    raw = page()
    source_path.write_bytes(raw)
    first, second = tmp_path / "one", tmp_path / "two"
    assert pc.collect_catalog(first, protocol_ids=("121704",), input_dir=source) == 1
    assert pc.collect_catalog(second, protocol_ids=("121704",), input_dir=source) == 1
    assert (first / "catalog.jsonl").read_bytes() == (second / "catalog.jsonl").read_bytes()
    assert source_path.read_bytes() == raw
    assert (first / "sources/121704.html").read_bytes() == raw
    manifest = json.loads((first / "manifest.json").read_text())
    assert manifest["complete"] is True
    assert manifest["catalogSha256"] == "sha256:" + hashlib.sha256(
        (first / "catalog.jsonl").read_bytes()
    ).hexdigest()
    with pytest.raises(ValueError, match="immutable"):
        pc.collect_catalog(first, protocol_ids=("121704",), input_dir=source)


def test_no_network_without_explicit_opt_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden_fetch(protocol_id: str) -> bytes:
        raise AssertionError(f"Unexpected network for {protocol_id}")

    monkeypatch.setattr(pc, "fetch_protocol", forbidden_fetch)
    output = tmp_path / "out"
    with pytest.raises(ValueError, match="explicit"):
        pc.collect_catalog(output)
    assert not output.exists()


def test_failed_batch_never_publishes_catalog(tmp_path: Path) -> None:
    source = tmp_path / "input"
    source.mkdir()
    (source / "121704.html").write_bytes(page())
    (source / "121705.html").write_bytes(b"<h1>Service unavailable</h1>")
    output = tmp_path / "out"
    with pytest.raises(ValueError, match="login/error/layout"):
        pc.collect_catalog(output, protocol_ids=("121704", "121705"), input_dir=source)
    assert not output.exists()


def test_rejects_symlink_and_redirects(tmp_path: Path) -> None:
    source = tmp_path / "input"
    source.mkdir()
    outside = tmp_path / "outside.html"
    outside.write_bytes(page())
    (source / "121704.html").symlink_to(outside)
    with pytest.raises(ValueError, match="symbolic"):
        pc.collect_catalog(tmp_path / "out", protocol_ids=("121704",), input_dir=source)
    with pytest.raises(ValueError, match="redirect"):
        pc._NoRedirect().redirect_request(
            Request(pc.BASE_URL + "121704"), None, 302, "Found", {}, "http://127.0.0.1/"
        )
