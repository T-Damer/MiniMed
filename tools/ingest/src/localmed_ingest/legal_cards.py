"""Regulatory cards with the full text of the act (LEGAL1).

A card of `content/regulatory-rf-pilot` is front matter + sections. Until LEGAL1 the sections were a
paraphrase of the act. The full-text card keeps

* the front matter (identity, edition, checksum), with `contentMode: source_text`, a short `description`
  (the first paragraph of the old card) and the reading metadata;
* the status section of a superseded or newly current act (the redirect), when the old card had one;
* the text of the act as reconciled from the official file (`legal_texts`);
* the footer «Источник и редакция», rewritten only where the text above changes what it says.

The text is the act as officially published; amendments published as separate acts are named in the
footer and are not merged into it (no silent substitution).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Final

FOOTER_TITLE: Final = "Источник и редакция"
STATUS_TITLES: Final = ("Статус документа", "Текущий статус")
_SECTION_SPLIT: Final = re.compile(r"\n(?=# )")
_COMMENT: Final = re.compile(r"<!--.*?-->", re.DOTALL)


@dataclass(frozen=True)
class Section:
    title: str
    text: str  # the whole section including its heading line and comments

    @property
    def paragraphs(self) -> list[str]:
        body = self.text.partition("\n")[2]
        visible = _COMMENT.sub("", body)
        return [p.strip() for p in re.split(r"\n\s*\n", visible) if p.strip()]


def split_card(text: str) -> tuple[str, str]:
    """(front matter without the fences, body)."""
    match = re.match(r"---\n(.*?)\n---\n(.*)", text, re.DOTALL)
    if match is None:
        raise ValueError("card has no front matter")
    return match.group(1), match.group(2)


def sections_of(body: str) -> list[Section]:
    parts = _SECTION_SPLIT.split(body.strip())
    return [
        Section(part.partition("\n")[0].lstrip("# ").strip(), part.strip() + "\n")
        for part in parts
        if part.strip()
    ]


def description_of(sections: list[Section]) -> str:
    for section in sections:
        if section.title == FOOTER_TITLE:
            continue
        if section.paragraphs:
            return section.paragraphs[0]
    raise ValueError("card has no paragraph to use as its description")


def status_section(sections: list[Section]) -> Section | None:
    first = sections[0] if sections else None
    if first is not None and first.title in STATUS_TITLES:
        return first
    return None


def footer_of(sections: list[Section]) -> Section:
    for section in reversed(sections):
        if section.title == FOOTER_TITLE:
            return section
    raise ValueError("card has no «Источник и редакция» footer")


_ORIGINAL_ONLY: Final = " Текст выше — первоначальная публикация, изменения в него не внесены."
_SCAN_LINE: Final = re.compile(r"^Текст набран с официального скана .*$")


def rewrite_footer(footer: Section, *, pages: int | None, amended: bool) -> str:
    """The footer with the edition line made honest about the text above it (idempotent)."""
    lines: list[str] = []
    text = footer.text.rstrip("\n").replace('"contentMode":"paraphrase"', '"contentMode":"source_text"')
    for raw in text.split("\n"):
        raw = raw.replace(_ORIGINAL_ONLY, "")
        if _SCAN_LINE.match(raw):
            continue
        if raw.startswith("Редакция:") and amended:
            lines.append(raw.rstrip(".") + "." + _ORIGINAL_ONLY)
        elif raw.startswith("Сверено с официальным текстом") and pages:
            lines.append(raw)
            lines.append("")
            lines.append(
                f"Текст набран с официального скана ({pages} стр.) и сверен постранично со вторым распознаванием."
            )
        else:
            lines.append(raw)
    out = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", out).rstrip("\n") + "\n"


def front_with(front: str, *, content_mode: str, description: str, extra: dict[str, object]) -> str:
    """Front matter text with the text-mode metadata set; the other lines are left as written."""
    lines = front.split("\n")
    out: list[str] = []
    for line in lines:
        if re.match(r"\s+contentMode:", line):
            out.append(re.sub(r"contentMode:.*", f"contentMode: {content_mode}", line))
        elif re.match(
            r"\s+(description|textReading|textPages|textPagesReviewed|textFlaggedPages|textSource):",
            line,
        ):
            continue
        else:
            out.append(line)
    label = next((i for i, line in enumerate(out) if line.startswith("version_label:")), None)
    if label is not None and "-fulltext" not in out[label]:
        out[label] = out[label].rstrip() + "-fulltext"
    insert_at = (
        max(
            i for i, line in enumerate(out) if line.startswith("  ") or line.startswith("metadata:")
        )
        + 1
    )
    additions = [f"  description: {json.dumps(description, ensure_ascii=False)}"]
    for key, value in extra.items():
        additions.append(f"  {key}: {json.dumps(value, ensure_ascii=False)}")
    out[insert_at:insert_at] = additions
    return "\n".join(out)


def assemble_card(
    old_text: str,
    text_body: str,
    *,
    pages: int | None,
    amended: bool,
    extra: dict[str, object],
) -> str:
    """The new card from the old card's text and the reconciled body of the act."""
    front, body = split_card(old_text)
    sections = sections_of(body)
    kept = re.search(r"^  description: (.*)$", front, re.MULTILINE)
    description = json.loads(kept.group(1)) if kept else description_of(sections)
    keep = status_section(sections)
    footer = rewrite_footer(footer_of(sections), pages=pages, amended=amended)
    parts = [keep.text.rstrip("\n") if keep else None, text_body.rstrip("\n"), footer.rstrip("\n")]
    new_body = "\n\n".join(part for part in parts if part)
    new_front = front_with(front, content_mode="source_text", description=description, extra=extra)
    return f"---\n{new_front}\n---\n{new_body}\n"


__all__ = [
    "FOOTER_TITLE",
    "Section",
    "assemble_card",
    "description_of",
    "footer_of",
    "front_with",
    "rewrite_footer",
    "sections_of",
    "split_card",
    "status_section",
]
