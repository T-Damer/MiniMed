"""Local check of the regulatory cards against the official portal (publication.pravo.gov.ru).

`bun run regulatory:verify` reads every card of `content/regulatory-rf-pilot` that names a portal
publication and asks the portal for

* the record: number and signing date must equal the card's (`record`);
* the official file: its SHA-256 and page count must equal `sourcePdfSha256` / `sourcePdfPages`
  of the card (`file`); a different file is a new edition of the text and needs a review;
* amending or repealing orders published after it that the card's `edition` line does not name
  (`unlisted amendments`).

The report goes to `content/regulatory-rf-verification.json` (committed: it is the evidence of the
last verification). Network failures are `error`, never a pass. Federal laws and acts without a
portal publication are listed as `not-checked` with the reason. Scanned PDFs have no text layer;
the reviewed comparison of card text with the scan (macOS Vision OCR) is described in
docs/REGULATORY_PACK.md and is not repeated here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import yaml

from localmed_ingest.medical_form_updates import (
    PortalClient,
    PortalError,
    find_related_orders,
)

REPO: Final = Path(__file__).resolve().parents[4]
PACK: Final = REPO / "content/regulatory-rf-pilot"
REPORT: Final = REPO / "content/regulatory-rf-verification.json"
RAW: Final = REPO / "data/raw/regulatory-sources"


def load_cards(pack: Path = PACK) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for path in sorted(pack.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        match = re.match(r"---\n(.*?)\n---\n", text, re.S)
        if match is None:
            raise ValueError(f"{path} has no front matter")
        front = yaml.safe_load(match.group(1))
        if front.get("source_type") == "regulatory_act_summary":
            cards.append({"path": path.name, **front})
    return cards


def _amending_number(item: dict[str, str]) -> str:
    return item["number"]


def verify_card(client: PortalClient, card: dict[str, Any], download: bool) -> dict[str, Any]:
    meta = card["metadata"]
    result: dict[str, Any] = {
        "documentId": card["id"],
        "documentNumber": meta["documentNumber"],
        "signedAt": meta["signedAt"],
        "status": card["status"],
        "edition": meta["edition"],
    }
    eo = str(meta.get("officialPublicationNumber", ""))
    if not re.fullmatch(r"\d{16}", eo):
        result["verdict"] = "not-checked"
        result["reason"] = "no publication.pravo.gov.ru record"
        result["officialSourceUrl"] = meta["officialSourceUrl"]
        return result
    problems: list[str] = []
    record = client.document(eo)
    result["eoNumber"] = eo
    result["record"] = {
        "number": record.get("number"),
        "documentDate": str(record.get("documentDate", ""))[:10],
        "publishedAt": str(record.get("publishDateShort", ""))[:10],
        "pagesCount": record.get("pagesCount"),
    }
    if str(record.get("number")) != str(meta["documentNumber"]):
        problems.append(f"number {record.get('number')} != {meta['documentNumber']}")
    if str(record.get("documentDate", ""))[:10] != str(meta["signedAt"]):
        problems.append(f"date {str(record.get('documentDate'))[:10]} != {meta['signedAt']}")
    if download:
        raw = RAW / f"{eo}.pdf"
        if not raw.exists():
            RAW.mkdir(parents=True, exist_ok=True)
            raw.write_bytes(
                client.get_bytes(f"http://publication.pravo.gov.ru/file/pdf?eoNumber={eo}")
            )
        digest = hashlib.sha256(raw.read_bytes()).hexdigest()
        result["file"] = {"sha256": digest, "bytes": raw.stat().st_size}
        if digest != meta.get("sourcePdfSha256"):
            problems.append("official file differs from sourcePdfSha256")
    if record.get("pagesCount") != meta.get("sourcePdfPages"):
        problems.append(f"pages {record.get('pagesCount')} != {meta.get('sourcePdfPages')}")
    source = {
        "eoNumber": eo,
        "orderNumber": meta["documentNumber"],
        "orderDate": meta["signedAt"],
        "publishedAt": str(meta.get("officialPublicationDate", "0000-00-00")),
        "watchTerms": [],
    }
    amending, _ = find_related_orders(client, source)
    result["amendingOrders"] = [
        {
            "number": item["number"],
            "documentDate": item["documentDate"],
            "eoNumber": item["eoNumber"],
        }
        for item in amending
    ]
    unlisted = [
        item["number"]
        for item in amending
        if re.sub(r"\D", "", item["number"]) not in re.sub(r"[^\d]+", " ", meta["edition"]).split()
        and card["status"] == "active"
        and meta.get("documentKind") == "приказ"
    ]
    if unlisted:
        problems.append("amending orders not named in edition: " + ", ".join(unlisted))
    result["problems"] = problems
    result["verdict"] = "ok" if not problems else "review"
    return result


def run(download: bool, report: Path) -> int:
    client = PortalClient()
    rows: list[dict[str, Any]] = []
    failed = False
    for card in load_cards():
        try:
            rows.append(verify_card(client, card, download))
        except (PortalError, OSError) as error:
            rows.append({"documentId": card["id"], "verdict": "error", "reason": str(error)})
            failed = True
    summary: dict[str, int] = {}
    for row in rows:
        summary[row["verdict"]] = summary.get(row["verdict"], 0) + 1
    payload = {
        "schemaVersion": 1,
        "checkedAt": datetime.now(UTC).strftime("%Y-%m-%d"),
        "summary": summary,
        "documents": rows,
    }
    report.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    for row in rows:
        if row["verdict"] in {"review", "error"}:
            print(row["documentId"], row.get("problems") or row.get("reason"), file=sys.stderr)
    return 1 if failed or summary.get("review") else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--no-download", action="store_true", help="skip the official file hash")
    args = parser.parse_args()
    raise SystemExit(run(not args.no_download, args.report))


if __name__ == "__main__":
    main()
