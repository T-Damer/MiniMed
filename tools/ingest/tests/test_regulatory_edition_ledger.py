from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
PILOT_ROOT = ROOT / "content" / "regulatory-rf-pilot"
LEDGER_PATH = ROOT / "content" / "regulatory-rf-editions.yaml"


def _front_matter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n"), f"{path} has no YAML front matter"
    end = text.find("\n---\n", 4)
    assert end >= 0, f"{path} has unterminated YAML front matter"
    value = yaml.safe_load(text[4:end])
    assert isinstance(value, dict), f"{path} front matter is not a mapping"
    return value


def _active_cards() -> dict[str, dict[str, object]]:
    cards: dict[str, dict[str, object]] = {}
    for path in sorted(PILOT_ROOT.glob("*.md")):
        metadata = _front_matter(path)
        if metadata.get("source_type") != "regulatory_act_summary":
            continue
        if metadata.get("status") != "active":
            continue
        document_id = metadata.get("id")
        assert isinstance(document_id, str) and document_id
        assert document_id not in cards, f"duplicate regulatory document id: {document_id}"
        cards[document_id] = metadata
    return cards


def test_every_active_regulatory_card_has_a_current_edition_review() -> None:
    ledger = yaml.safe_load(LEDGER_PATH.read_text(encoding="utf-8"))
    assert isinstance(ledger, dict)
    assert ledger.get("schema_version") == 1

    policy = ledger.get("policy")
    assert isinstance(policy, dict)
    maximum_interval = policy.get("maximum_review_interval_days")
    assert isinstance(maximum_interval, int) and maximum_interval > 0

    rows = ledger.get("documents")
    assert isinstance(rows, list) and rows
    indexed: dict[str, dict[str, object]] = {}
    for row in rows:
        assert isinstance(row, dict)
        document_id = row.get("document_id")
        assert isinstance(document_id, str) and document_id
        assert document_id not in indexed, f"duplicate edition ledger row: {document_id}"
        indexed[document_id] = row

    cards = _active_cards()
    assert set(indexed) == set(cards), (
        "Edition ledger must cover every active regulatory card exactly; "
        f"missing={sorted(set(cards) - set(indexed))}, "
        f"orphaned={sorted(set(indexed) - set(cards))}"
    )

    today = date.today()
    latest_local_review_date = today + timedelta(days=1)
    for document_id, row in indexed.items():
        card = cards[document_id]
        card_details = card.get("metadata")
        assert isinstance(card_details, dict)

        document_number = row.get("document_number")
        publication_number = row.get("official_publication_number")
        official_url = row.get("official_url")
        assert isinstance(document_number, str) and document_number
        assert isinstance(publication_number, str) and publication_number
        assert isinstance(official_url, str) and official_url.startswith("https://")
        assert card_details.get("documentNumber") == document_number
        assert card_details.get("officialPublicationNumber") == publication_number
        assert card_details.get("officialSourceUrl") == official_url

        reviewed_at = date.fromisoformat(str(row.get("reviewed_at")))
        next_review_by = date.fromisoformat(str(row.get("next_review_by")))
        assert reviewed_at <= latest_local_review_date, (
            f"{document_id} review is more than one local-calendar day in the future"
        )
        assert today <= next_review_by, f"{document_id} edition review expired on {next_review_by}"
        assert (next_review_by - reviewed_at).days <= maximum_interval, (
            f"{document_id} review window exceeds {maximum_interval} days"
        )
        assert card_details.get("sourceReviewedAt") == reviewed_at.isoformat()

        audience = row.get("audience")
        age_groups = card.get("age_groups")
        assert isinstance(audience, list) and audience
        assert isinstance(age_groups, list) and age_groups
        assert set(audience) == set(age_groups), (
            f"{document_id} audience differs from the card age_groups"
        )
