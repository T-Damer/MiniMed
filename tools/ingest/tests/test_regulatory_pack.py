"""Integrity of the regulatory pack that ships as `minimed.regulatory.pediatrics.ru`.

Search by act number is covered by `tools/benchmarks/regulatory-rf-number-queries.json`
(`bun run benchmark:regulatory`, every act must be the first result of «приказ <номер>»).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from localmed_ingest.builder import build_content_pack, lint_content_pack, load_content_pack
from localmed_ingest.regulatory_distribution import (
    check_act_metadata,
    package_regulatory_module,
)

ROOT = Path(__file__).resolve().parents[3]
PACK = ROOT / "content" / "regulatory-rf-pilot"
FOOTER = "# Источник и редакция"
FORBIDDEN = ("врач не проверял", "не проверял врач", "юридическую консультацию")
CARD_LIMITS = re.compile(r"^# Ограничения(?: карточки)?$", re.M)
CHECKSUM = "sha256:" + "0" * 64


def _meta(front: dict[str, object]) -> dict[str, object]:
    value = front["metadata"]
    assert isinstance(value, dict)
    return {str(k): v for k, v in value.items()}


def _cards() -> list[tuple[Path, dict[str, object], str]]:
    cards = []
    for path in sorted(PACK.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        match = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
        assert match, f"{path.name} has no front matter"
        cards.append((path, yaml.safe_load(match.group(1)), match.group(2)))
    return cards


def _acts() -> list[tuple[Path, dict[str, object], str]]:
    return [card for card in _cards() if card[1]["source_type"] == "regulatory_act_summary"]


def test_every_act_is_complete() -> None:
    acts = _acts()
    assert len(acts) >= 30
    for path, front, _body in acts:
        metadata = _meta(front)
        problems = check_act_metadata(
            str(front["id"]), str(front["source_type"]), metadata, CHECKSUM
        )
        assert problems == [], f"{path.name}: {problems}"


def test_every_card_has_text_in_every_section_and_a_source_footer() -> None:
    for path, front, body in _cards():
        sections = re.split(r"\n(?=# )", body.strip())
        assert sections, path.name
        for section in sections:
            title, _, text = section.partition("\n")
            visible = re.sub(r"<!--.*?-->", "", text, flags=re.S).strip()
            assert visible, f"{path.name}: empty section {title}"
        assert sections[-1].startswith(FOOTER), f"{path.name}: the source footer comes last"
        assert CARD_LIMITS.search(body) is None, f"{path.name}: a card-limits disclaimer section"
        for phrase in FORBIDDEN:
            assert phrase not in body, f"{path.name}: {phrase!r} is a disclaimer, not content"
        metadata = _meta(front)
        if front["source_type"] == "regulatory_act_summary":
            assert str(metadata["documentNumber"]) in sections[-1]
            assert str(metadata["officialSourceUrl"]) in sections[-1]


def test_document_number_leads_the_title() -> None:
    for path, front, _body in _acts():
        number = str(_meta(front)["documentNumber"])
        assert number in str(front["title"]), f"{path.name}: the title names {number}"


def test_verification_report_covers_every_act() -> None:
    report = json.loads((ROOT / "content" / "regulatory-rf-verification.json").read_text("utf-8"))
    reported = {row["documentId"]: row for row in report["documents"]}
    assert set(reported) == {str(front["id"]) for _p, front, _b in _acts()}
    assert report["summary"].get("review", 0) == 0
    assert report["summary"].get("error", 0) == 0
    for _path, front, _body in _acts():
        row = reported[str(front["id"])]
        assert row["verdict"] in {"ok", "not-checked"}
        if row["verdict"] == "not-checked":
            assert row["reason"] and row["officialSourceUrl"]


def test_pack_builds_and_packages(tmp_path: Path) -> None:
    assert lint_content_pack(load_content_pack(PACK)) == []
    database = tmp_path / "regulatory.db"
    build_content_pack(PACK, database, include_embeddings=False)
    report = package_regulatory_module(
        database, tmp_path / "release", version="2026.10.13", min_app_version="0.6.59"
    )
    entry = json.loads(Path(str(report["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["id"] == "minimed.regulatory.pediatrics.ru"
    assert entry["kind"] == "regulatory"
    assert entry["releaseState"] == "published"
    assert entry["compatibility"]["minAppVersion"] == "0.6.59"
    assert len(entry["documents"]) == len(_cards())
    assert report["acts"] == len(_acts())


def test_an_act_without_its_numbers_cannot_be_packaged() -> None:
    _path, front, _body = _acts()[0]
    metadata = _meta(front)
    for key in ("documentNumber", "signedAt", "issuer", "edition"):
        broken = {k: v for k, v in metadata.items() if k != key}
        assert any(
            key in problem
            for problem in check_act_metadata(
                str(front["id"]), "regulatory_act_summary", broken, CHECKSUM
            )
        )
    assert check_act_metadata("x", "regulatory_act_summary", metadata, "md5:1")
