"""The bundled regulatory pack: 323-FZ in full text and a light card for every other act.

The full-text pack (`content/regulatory-rf-pilot`, 31 documents, 27.8 MB) is the downloadable
module `minimed.regulatory.pediatrics.ru`. The app bundles a much smaller pack that still finds
every act offline and offers the module in place:

- the main law (Federal Law 323-FZ on the basics of health protection) and the status crosswalk
  keep their prepared Markdown byte for byte, so their text, anchors and checksums are the module's;
- every other act becomes a *module-pointer card* with the same document id: the official title (the
  first paragraph of the act, with its source page), the short description the card always had, the
  headings of the act as one list and the verbatim source-and-edition section. Its metadata
  names the module (`contentMode: module-pointer`, `targetDocumentId` = its own id), which is what
  makes the reader show the download offer and what makes the module replace the card, because the
  module carries the same ids and the bundled pack is not mounted next to the installed module.

Nothing is summarised or reworded here: every sentence of a card is copied from the prepared act or
is the card description of the act's metadata; the headings are cut only at a word boundary when
longer than `MAX_HEADING_CHARS`.
"""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import yaml

from .markdown_parser import HEADING_PATTERN

MODULE_ID = "minimed.regulatory.pediatrics.ru"
LIGHT_PACK_ID = "minimed.rf-regulatory-index"
LIGHT_PACK_TITLE = "MiniMed regulatory index: 323-FZ in full text and the list of acts"
# Prepared in full in the bundled pack (their text is small or is the one law every reader needs).
FULL_TEXT_DOCUMENT_IDS = frozenset(
    {
        "regulatory.rf.federal-law.323-fz-2011",
        "regulatory.rf.reference.pediatric-orders-study-list-2026",
    }
)
SOURCE_SECTION_TITLE = "Источник и редакция"
OUTLINE_SECTION_TITLE = "Содержание"
MAX_HEADING_CHARS = 240
MAX_OUTLINE_LEVEL = 2
# Provenance of the full text that a card does not carry.
DROPPED_METADATA_KEYS = ("textReading", "textPages", "textFlaggedPages", "textPagesReviewed")
_FRONT_MATTER_END = "\n---\n"
_SOURCE_MARKER = re.compile(r"^<!--\s*localmed:source\s+.+?-->$")


@dataclass(frozen=True)
class LightCard:
    document_id: str
    file_name: str
    full_text: bool
    outline_entries: int
    full_chars: int
    card_chars: int


def _split(text: str) -> tuple[dict[str, object], str]:
    if not text.startswith("---\n"):
        raise ValueError("Prepared act must start with YAML front matter")
    end = text.find(_FRONT_MATTER_END, 4)
    if end < 0:
        raise ValueError("Prepared act has an unterminated front matter block")
    loaded = yaml.safe_load(text[4:end])
    if not isinstance(loaded, dict):
        raise ValueError("Front matter must be a mapping")
    return {str(key): value for key, value in loaded.items()}, text[end + len(_FRONT_MATTER_END) :]


def _clip(title: str) -> str:
    if len(title) <= MAX_HEADING_CHARS:
        return title
    cut = title[:MAX_HEADING_CHARS].rsplit(" ", 1)[0].rstrip(",;:- ")
    return f"{cut}…"


def _sections(body: str) -> list[tuple[int, str, list[str]]]:
    """(level, title, lines) per heading in document order, as the pack builder reads them."""
    found: list[tuple[int, str, list[str]]] = []
    for line in body.splitlines():
        match = HEADING_PATTERN.match(line)
        if match:
            found.append((len(match.group(1)), match.group(2).strip(), []))
        elif found:
            found[-1][2].append(line)
    return found


def _first_paragraph(lines: list[str]) -> list[str]:
    """The first source-marked paragraph of a section, marker included (verbatim lines)."""
    taken: list[str] = []
    for line in lines:
        if not taken and not line.strip():
            continue
        if taken and not line.strip():
            break
        if taken and _SOURCE_MARKER.match(line.strip()):
            break
        taken.append(line)
    return taken


def _outline(sections: list[tuple[int, str, list[str]]]) -> list[str]:
    """Headings of the act (below its title, above «Источник и редакция») as one bullet list."""
    entries: list[str] = []
    parent = ""
    for index, (level, title, _lines) in enumerate(sections):
        if index == 0 or title == SOURCE_SECTION_TITLE or level > MAX_OUTLINE_LEVEL:
            continue
        clipped = _clip(title)
        if level == 1:
            parent = clipped
            following = sections[index + 1][0] if index + 1 < len(sections) else 1
            # A heading that only introduces its sub-headings is carried by their entries.
            if following != 2:
                entries.append(f"- {clipped}")
        else:
            entries.append(f"- {parent} — {clipped}" if parent else f"- {clipped}")
    unique: list[str] = []
    for entry in entries:
        if entry not in unique:
            unique.append(entry)
    return unique


def light_card(text: str, *, file_name: str) -> tuple[str, LightCard]:
    """The module-pointer card of one prepared act, as Markdown with front matter."""
    front, body = _split(text)
    document_id = str(front["id"])
    sections = _sections(body)
    if not sections:
        raise ValueError(f"{document_id}: no headings")
    title_level, title, title_lines = sections[0]
    if title_level != 1:
        raise ValueError(f"{document_id}: the first heading must be level 1")
    source = next((entry for entry in sections if entry[1] == SOURCE_SECTION_TITLE), None)
    if source is None:
        raise ValueError(f"{document_id}: no «{SOURCE_SECTION_TITLE}» section")
    metadata = front.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError(f"{document_id}: metadata is missing")
    card_metadata: dict[str, object] = {
        str(key): value for key, value in metadata.items() if key not in DROPPED_METADATA_KEYS
    }
    card_metadata.update(
        {
            "fullTextContentMode": metadata.get("contentMode"),
            "contentMode": "module-pointer",
            "textTier": "index",
            "pointerKind": "regulatory-text",
            "targetDocumentId": document_id,
            "primaryModuleId": MODULE_ID,
            "moduleIds": [MODULE_ID],
        }
    )
    card_front = {**front, "metadata": card_metadata}

    lines: list[str] = [f"# {title}", ""]
    first = _first_paragraph(title_lines)
    if first:
        lines.extend([*first, ""])
    description = metadata.get("description")
    first_text = " ".join(line.strip() for line in first if not _SOURCE_MARKER.match(line.strip()))
    if isinstance(description, str) and description.strip():
        card_description = description.strip()
        # The title paragraph already says it (an act whose description is its official title).
        if card_description.rstrip("…") not in first_text:
            lines.extend(
                ['<!-- localmed:source {"derived":"cardDescription"} -->', card_description, ""]
            )
    outline = _outline(sections)
    if outline:
        lines.extend([f"# {OUTLINE_SECTION_TITLE}", "", *outline, ""])
    lines.append(f"# {SOURCE_SECTION_TITLE}")
    lines.extend(source[2])
    rendered = (
        "---\n"
        + yaml.safe_dump(card_front, allow_unicode=True, sort_keys=False, width=100000)
        + "---\n"
        + "\n".join(lines).rstrip("\n")
        + "\n"
    )
    return rendered, LightCard(
        document_id=document_id,
        file_name=file_name,
        full_text=False,
        outline_entries=len(outline),
        full_chars=len(text),
        card_chars=len(rendered),
    )


def write_light_sources(input_dir: Path, output_dir: Path) -> list[LightCard]:
    """Write the bundled pack's Markdown, aliases and manifest; returns one entry per document."""
    if output_dir.resolve() == input_dir.resolve():
        raise ValueError("The light sources must not overwrite the full-text sources")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    cards: list[LightCard] = []
    for path in sorted(input_dir.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        front, _body = _split(text)
        document_id = str(front["id"])
        if document_id in FULL_TEXT_DOCUMENT_IDS:
            (output_dir / path.name).write_text(text, encoding="utf-8")
            cards.append(LightCard(document_id, path.name, True, 0, len(text), len(text)))
            continue
        rendered, card = light_card(text, file_name=path.name)
        (output_dir / path.name).write_text(rendered, encoding="utf-8")
        cards.append(card)
    missing = FULL_TEXT_DOCUMENT_IDS - {card.document_id for card in cards if card.full_text}
    if missing:
        raise ValueError(f"Full-text documents missing from {input_dir}: {sorted(missing)}")
    shutil.copyfile(input_dir / "aliases.yaml", output_dir / "aliases.yaml")
    manifest = yaml.safe_load((input_dir / "manifest.yaml").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("manifest.yaml must be a mapping")
    manifest.update({"id": LIGHT_PACK_ID, "title": LIGHT_PACK_TITLE})
    (output_dir / "manifest.yaml").write_text(
        yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    return cards


__all__ = [
    "FULL_TEXT_DOCUMENT_IDS",
    "LIGHT_PACK_ID",
    "MODULE_ID",
    "LightCard",
    "light_card",
    "write_light_sources",
]
