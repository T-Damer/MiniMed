"""Acts that come as text, not as a scan (LEGAL1): a Word file of minzdrav.gov.ru, the HTML of rg.ru and of the
official IPS of pravo.gov.ru. The text is exact (no OCR), so these acts need no reconciliation; they pass through
the same block structure as the scanned ones and keep the checksum of the file they were read from.

`docx_to_markdown`, `rg_html_to_markdown` and `ips_html_to_markdown` return Markdown in the shape of Marker's output:
blank-line separated paragraphs, bold-only lines for headings, pipe tables.
"""

from __future__ import annotations

import re
import zipfile
from io import BytesIO
from typing import Final
from xml.etree import ElementTree

from bs4 import BeautifulSoup, Tag

_W: Final = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_TO_SUPERSCRIPT: Final = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
_FOOTNOTE_MARK: Final = re.compile(r"(?:&lt;|<)(\d{1,3})(?:&gt;|>)")
_RULE: Final = re.compile(r"^[-_–—=\s]{8,}$")


def _normalize(text: str) -> str:
    value = text.replace("\xa0", " ").replace("​", "")
    value = _FOOTNOTE_MARK.sub(lambda m: m.group(1).translate(_TO_SUPERSCRIPT), value)
    return re.sub(r"[ \t]+", " ", value).strip()


def _row(cells: list[str]) -> str:
    return "| " + " | ".join(cell.replace("|", "\\|") for cell in cells) + " |"


def _table(rows: list[list[str]]) -> str:
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    lines = [_row(padded[0]), "| " + " | ".join("---" for _ in range(width)) + " |"]
    lines.extend(_row(row) for row in padded[1:])
    return "\n".join(lines)


def _word_text(element: ElementTree.Element) -> str:
    parts: list[str] = []
    for node in element.iter():
        if node.tag == f"{_W}t" and node.text:
            parts.append(node.text)
        elif node.tag in (f"{_W}tab", f"{_W}br", f"{_W}cr"):
            parts.append(" ")
    return _normalize("".join(parts))


def docx_to_markdown(data: bytes) -> str:
    """Paragraphs and tables of a Word file, in order. Separator rules of consolidated exports are dropped."""
    with zipfile.ZipFile(BytesIO(data)) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    body = root.find(f"{_W}body")
    if body is None:
        raise ValueError("the Word file has no body")
    blocks: list[str] = []
    for child in body:
        if child.tag == f"{_W}p":
            text = _word_text(child)
            if text and not _RULE.match(text):
                blocks.append(text)
        elif child.tag == f"{_W}tbl":
            rows: list[list[str]] = []
            for tr in child.iter(f"{_W}tr"):
                rows.append([_word_text(tc) for tc in tr.findall(f"{_W}tc")])
            if rows:
                blocks.append(_table(rows))
    return "\n\n".join(blocks)


def _cell_text(cell: Tag) -> str:
    return _normalize(cell.get_text(" "))


def _html_blocks(container: Tag, heading_classes: frozenset[str]) -> list[str]:
    blocks: list[str] = []
    for node in container.find_all(["p", "table", "h1", "h2", "h3", "h4"], recursive=True):
        if node.name == "table":
            rows = [
                [_cell_text(c) for c in tr.find_all(["td", "th"])] for tr in node.find_all("tr")
            ]
            rows = [r for r in rows if any(r)]
            if rows:
                blocks.append(_table(rows))
            continue
        if node.find_parent("table") is not None:
            continue
        text = _normalize(node.get_text(" "))
        text = re.sub(r"\s+([,.;:)])", r"\1", text)
        if not text or _RULE.match(text):
            continue
        if text.startswith("Прим. ред."):
            continue
        classes = set(node.get("class") or [])
        bold = node.name != "p" or bool(classes & heading_classes)
        if not bold:
            strong = node.find(["strong", "b"])
            bold = strong is not None and _normalize(strong.get_text(" ")) == text
        blocks.append(f"**{text}**" if bold and len(text) < 260 else text)
    return blocks


def rg_html_to_markdown(html: str) -> str:
    """The text of a Rossiyskaya Gazeta document page (`PageDocumentContent_text`)."""
    soup = BeautifulSoup(html, "html.parser")
    container = soup.find(class_=re.compile(r"PageDocumentContent_text"))
    if not isinstance(container, Tag):
        raise ValueError("no document text on the page")
    return "\n\n".join(_html_blocks(container, frozenset()))


def ips_html_to_markdown(pages: list[str]) -> str:
    """The text of an IPS (pravo.gov.ru/proxy/ips) document from its consecutive `doc_itself` pages."""
    blocks: list[str] = []
    for html in pages:
        soup = BeautifulSoup(html, "html.parser")
        body = soup.find("body")
        if not isinstance(body, Tag):
            raise ValueError("an IPS page has no body")
        blocks.extend(_html_blocks(body, frozenset({"H", "T"})))
    return "\n\n".join(blocks)


__all__ = ["docx_to_markdown", "ips_html_to_markdown", "rg_html_to_markdown"]
