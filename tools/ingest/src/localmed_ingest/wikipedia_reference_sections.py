"""Render pinned MediaWiki reference sections as text, never executable scoring rules.

Paragraph/list order and physical table cells are retained. HTML layout becomes plain text;
merged-cell geometry is provenance requiring review. Remote assets are never fetched.
The original API response is independent source evidence, not part of a phone download.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser


@dataclass
class Element:
    tag: str
    attrs: dict[str, str]
    children: list[Element | str] = field(default_factory=list)


class SourceHtml(HTMLParser):
    def __init__(self, html: str) -> None:
        super().__init__(convert_charrefs=True)
        if len(html) > 4 * 1024 * 1024 or "\0" in html:
            raise ValueError("Invalid or oversized source HTML")
        self.root = Element("root", {})
        self.stack = [self.root]
        self.elements = 0
        self.feed(html)
        self.close()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.elements += 1
        if self.elements > 100000 or len(self.stack) > 128:
            raise ValueError("Source HTML exceeds structural budget")
        node = Element(tag, {key: value or "" for key, value in attrs})
        self.stack[-1].children.append(node)
        if tag not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        self.stack[-1].children.append(re.sub(r"\s+", " ", data))


def descendants(node: Element, tag: str) -> list[Element]:
    found: list[Element] = []
    for child in node.children:
        if isinstance(child, Element):
            if child.tag == tag:
                found.append(child)
            found.extend(descendants(child, tag))
    return found


def omitted(node: Element) -> bool:
    classes = set(node.attrs.get("class", "").split())
    return node.tag in {
        "script",
        "style",
        "link",
        "meta",
        "img",
        "svg",
        "figure",
        "audio",
        "video",
    } or bool(
        classes
        & {"navbox", "vertical-navbox", "metadata", "ambox", "mw-editsection", "toc", "noprint"}
    )


def compact(value: str) -> str:
    return "\n".join(re.sub(r"[^\S\n]+", " ", line).strip() for line in value.splitlines()).strip()


def cell_span(node: Element, key: str) -> int:
    raw = node.attrs.get(key, "1")
    if not re.fullmatch(r"\d{1,4}", raw) or not 1 <= int(raw) <= 1000:
        raise ValueError("Unsupported source table span")
    return int(raw)


def table_grid(node: Element) -> list[list[dict[str, object]]]:
    if descendants(node, "table"):
        raise ValueError("Nested source table needs a separate review")
    grid: list[list[dict[str, object]]] = []
    for row in descendants(node, "tr"):
        cells: list[dict[str, object]] = []
        for cell in row.children:
            if isinstance(cell, Element) and cell.tag in {"th", "td"}:
                cells.append(
                    {
                        "text": compact(render(cell)),
                        "header": cell.tag == "th",
                        "rowspan": cell_span(cell, "rowspan"),
                        "colspan": cell_span(cell, "colspan"),
                    }
                )
        if cells:
            grid.append(cells)
    if len(grid) > 1000 or any(len(row) > 100 for row in grid):
        raise ValueError("Source table exceeds its cell budget")
    return grid


def render(node: Element | str) -> str:
    if isinstance(node, str):
        return node
    if omitted(node):
        return ""
    if node.tag == "br":
        return "\n"
    if node.tag == "math":
        return node.attrs.get("alttext") or "".join(render(c) for c in node.children)
    if node.tag in {"ol", "ul"}:
        raw_start = node.attrs.get("start", "1")
        if not re.fullmatch(r"-?\d{1,5}", raw_start):
            raise ValueError("Invalid source list start")
        index = int(raw_start)
        lines: list[str] = []
        for child in node.children:
            if isinstance(child, Element) and child.tag == "li":
                override = child.attrs.get("value")
                if override is not None:
                    if not re.fullmatch(r"-?\d{1,5}", override):
                        raise ValueError("Invalid source list value")
                    index = int(override)
                marker = f"{index}. " if node.tag == "ol" else "• "
                lines.append(marker + compact("".join(render(c) for c in child.children)))
                index += 1
            elif isinstance(child, Element) and not omitted(child):
                lines.append(compact(render(child)))
        return "\n" + "\n".join(lines) + "\n"
    if node.tag == "table":
        lines = [
            compact(render(c))
            for c in node.children
            if isinstance(c, Element) and c.tag == "caption"
        ]
        for row in table_grid(node):
            values: list[str] = []
            for cell in row:
                label = str(cell["text"]).replace("\n", " / ")
                if cell["rowspan"] != 1 or cell["colspan"] != 1:
                    label += f" [rowspan={cell['rowspan']}, colspan={cell['colspan']}]"
                values.append(label)
            lines.append(" | ".join(values))
        return "\n" + "\n".join(lines) + "\n"
    body = "".join(render(c) for c in node.children)
    if node.tag in {"sup", "sub"} and body.strip():
        return ("^(" if node.tag == "sup" else "_(") + body.strip() + ")"
    if node.tag in {"p", "div", "blockquote", "pre", "dt", "dd"}:
        return "\n" + body + "\n"
    return body


@dataclass
class Section:
    title: str
    anchor: str
    parts: list[str] = field(default_factory=list)
    tables: list[list[list[dict[str, object]]]] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(self.parts)


def extract_sections(html: str) -> tuple[list[Section], dict[str, int]]:
    root = SourceHtml(html).root
    sections = [Section("Вводный раздел", "")]
    omissions: dict[str, int] = {}
    units = {"p", "ol", "ul", "dl", "table", "blockquote", "pre"}

    def walk(node: Element | str) -> None:
        if isinstance(node, str):
            if node.strip():
                sections[-1].parts.append(node.strip())
            return
        if omitted(node):
            key = "media" if node.tag in {"img", "svg", "figure", "audio", "video"} else "layout"
            omissions[key] = omissions.get(key, 0) + 1
            return
        if re.fullmatch(r"h[2-6]", node.tag):
            anchor = node.attrs.get("id", "")
            if not anchor:
                anchors = [n.attrs["id"] for n in descendants(node, "span") if "id" in n.attrs]
                anchor = anchors[0] if anchors else ""
            title = compact(render(node))
            if title:
                sections.append(Section(title, anchor))
            return
        if node.tag in units:
            body = compact(render(node))
            if body:
                sections[-1].parts.append(body)
            tables = [node] if node.tag == "table" else descendants(node, "table")
            for table in tables:
                if not omitted(table):
                    sections[-1].tables.append(table_grid(table))
            for tag in ("img", "svg", "figure", "audio", "video"):
                omissions["media"] = omissions.get("media", 0) + len(descendants(node, tag))
            return
        for child in node.children:
            walk(child)

    walk(root)
    result = [section for section in sections if section.parts]
    if not result or result[0].anchor or len(result[0].text) < 30:
        raise ValueError("No substantive source introduction")
    if len(result) > 200 or any(len(section.text) > 262144 for section in result):
        raise ValueError("Rendered source section exceeds its budget")
    return result, omissions
