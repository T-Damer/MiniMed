"""The table of contents of a patient leaflet, recognised in extracted blocks.

A ГРЛС patient leaflet («листок-вкладыш») opens with «Содержание листка-вкладыша», a numbered list
of its own sections («1. Что из себя представляет препарат …», «2. О чем следует знать …»,
… «6. Содержимое упаковки …»), and the real sections follow with the same titles as headings. The
generic PDF heading rule cannot tell the two apart: an entry that ends in a common heading phrase
(«4. Возможные нежелательные реакции.») was made a heading, and the instruction re-segmenter later
cut the other entries at the standard phrases they contain («3. Прием препарата …»,
«5. Хранение препарата …»), leaving the list numbers behind as one-token chunks.

This module only *recognises* the list (no block is edited, dropped or reordered): the renderer
keeps every block of a run as one list block of the prepared Markdown, with the ids of the blocks it
covers in the source marker. A run is

- the entries «N. title» numbered 1, 2, 3 … without a gap, one per line or per block (two entries on
  one line allowed), a wrapped title (a continuation line or a short paragraph block) allowed, a
  number that stands alone in its block joined with the title block that follows it;
- in a scan, an entry whose number the recognition lost or misread («А. Возможные …») counts as the
  next entry when it is a short heading or list block and the whole list is confirmed by repetition;
- opened by a short «Содержание» / «Оглавление» block (optionally «… листка-вкладыша» /
  «… инструкции»), or, without that header, of at least ``MIN_ENTRIES_WITHOUT_HEADER`` entries that
  all repeat as a heading or heading-led paragraph later in the document.

When the extraction put the list and the text after it into one block («1. … 6. …» followed by the
first section's own «1. Что из себя представляет …»), the run ends inside that block and records the
character offset where the list stops (``split``); the renderer cuts the block there into two
parts and loses no character.

Genuine numbered headings are not entries: the first line that is not the next number ends the run,
so «1. Что из себя представляет …» as a real section after a complete list is never swallowed.
A list is accepted only when most of its titles come back later in the document.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from .models import ExtractedBlock
from .normalization import normalize_surface_text

MIN_ENTRIES = 3
MIN_ENTRIES_WITHOUT_HEADER = 4
MIN_LEAFLET_SECTIONS = 2
MAX_ENTRIES = 14
#: A leaflet has six sections: past the sixth entry a block must carry its own number.
TOLERANT_LIMIT = 6
MAX_ENTRY_CHARACTERS = 220
MAX_CONTINUATION_CHARACTERS = 90
MAX_HEADER_CHARACTERS = 60
#: Share of the titles that must come back later in the document.
MIN_REPEATED_SHARE = 0.5
_HEADER = re.compile(
    r"^(?:содержание|оглавление)(?:\s+(?:листка[\s\-–—]*вкладыша|инструкции))?\s*[:.]?$"
)
_ENTRY = re.compile(r"^\s*(\d{1,2})\s*[.)]\s*(\S.*?)\s*$")
#: A scan reads «4.» as «А.» or drops the number: one letter and a dot, or nothing.
_MISREAD_ENTRY = re.compile(r"^\s*[^\W\d_]\s*[.)]\s+(\S.*?)\s*$")
_LONE_NUMBER = re.compile(r"^\s*(\d{1,2})\s*[.)]?\s*$")
_LEADING_NUMBER = re.compile(r"^\s*\d{1,2}(?:\s*[.)]\s*|\s+(?=[^\W\d_]))")
#: Two entries on one line: «… применяют. 2. О чем …».
_INLINE_BREAK = re.compile(r"(?<=\S)\s+(?=\d{1,2}\s*[.)]\s+[«\"А-ЯЁA-Z])")
_LINE = re.compile(r"[^\n]+")
#: «Содержание листка-вкладыша 1. …» inside a longer block: the header and the first entry.
_INLINE_HEADER = re.compile(
    r"(?:содержание|оглавление)(?:\s+листка[\s\-–—]*вкладыша)?\s*:?\s*(?=1\s*[.)]\s+[«\"А-ЯЁA-Z])",
    re.IGNORECASE,
)
#: The standard sections of a patient leaflet, as a normalised title starts.
_LEAFLET_SECTION = re.compile(
    r"^(?:что из себя представляет|что представляет собой|что такое|о чем следует знать|"
    r"что следует знать|прием препарата|применение препарата|как принимать|как применять|"
    r"возможные нежелательные реакции|какие побочные|хранение|как хранить|"
    r"содержимое упаковки)"
)
_WORD = re.compile(r"[^\W_]+")
_CONTENT_KINDS = frozenset({"paragraph", "list", "heading", "table_candidate"})
_TOLERANT_KINDS = frozenset({"heading", "list"})
_SENTENCE_END = (".", ";", ":", "!", "?")


@dataclass(frozen=True)
class ContentsEntry:
    number: int
    title: str
    """The title without its number, a wrapped title joined."""
    block_id: str
    """The block the entry starts in."""
    text: str
    """The entry exactly as the source has it (number, a misread number, wrapped lines joined by a
    space): the line the renderer writes."""

    def continued(self, line: str) -> ContentsEntry:
        return ContentsEntry(
            self.number, f"{self.title} {line}", self.block_id, f"{self.text} {line}"
        )


@dataclass(frozen=True)
class ContentsRun:
    header_id: str | None
    """The «Содержание …» block; ``None`` for a run recognised by repetition alone."""
    block_ids: tuple[str, ...]
    """Every block of the list, in document order (a lone number's block included)."""
    entries: tuple[ContentsEntry, ...]
    repeated: int
    """Entries whose title opens a later heading or paragraph."""
    split: tuple[str, int] | None = None
    """The last block when the extraction joined the list with the text after it: its id and the
    character offset in ``block.text`` where the text after the list begins."""
    head: tuple[str, int] | None = None
    """The first block when the extraction put text before the list into it: its id and the offset
    where the list (its «Содержание …» header) begins."""
    lead: str | None = None
    """The header exactly as printed, when it stands inside the first block."""


@dataclass(frozen=True)
class _Line:
    text: str
    start: int
    end: int


def is_contents_header(text: str) -> bool:
    candidate = normalize_surface_text(text).strip()
    return 0 < len(candidate) <= MAX_HEADER_CHARACTERS and _HEADER.fullmatch(candidate) is not None


def title_key(title: str) -> str:
    return " ".join(_WORD.findall(normalize_surface_text(_LEADING_NUMBER.sub("", title))))


def _unnumbered(line: str) -> str:
    """The line without a number the scan may have misread («А. Возможные …»)."""
    misread = _MISREAD_ENTRY.match(line)
    return misread.group(1) if misread is not None else line


def block_lines(block: ExtractedBlock) -> list[_Line]:
    """The non-empty lines of a block with their offsets, a line holding two entries split."""
    result: list[_Line] = []
    for raw in _LINE.finditer(block.text):
        text = raw.group(0)
        position = 0
        for match in [*_INLINE_BREAK.finditer(text), None]:
            stop = match.start() if match is not None else len(text)
            part = text[position:stop]
            stripped = part.strip()
            if stripped:
                start = raw.start() + position + (len(part) - len(part.lstrip()))
                result.append(_Line(stripped, start, start + len(stripped)))
            if match is not None:
                position = match.end()
    return result


@dataclass
class _Cursor:
    expected: int = 1
    entries: list[ContentsEntry] = field(default_factory=list[ContentsEntry])
    block_ids: list[str] = field(default_factory=list[str])
    pending_number: int | None = None
    """A number that stood alone in the previous block."""
    pending_text: str = ""
    seen_keys: set[str] = field(default_factory=set[str])
    has_header: bool = False
    split: tuple[str, int] | None = None


def _consume_block(block: ExtractedBlock, cursor: _Cursor, base: int = 0) -> bool:
    """Take ``block`` into the run when its lines are the next entries or wrapped titles.

    A block that starts with entries and then carries other text ends the run: the cut is recorded.
    """
    lines = block_lines(block)
    if not lines or block.kind not in _CONTENT_KINDS:
        return False
    taken: list[ContentsEntry] = []
    carried: ContentsEntry | None = None
    expected = cursor.expected
    pending = cursor.pending_number
    pending_text = cursor.pending_text
    continuing = bool(cursor.entries) and not cursor.entries[-1].title.endswith(_SENTENCE_END)
    cut: int | None = None
    for position, line in enumerate(lines):
        accepted = True
        entry_match = _ENTRY.match(line.text)
        lone = _LONE_NUMBER.match(line.text)
        if expected > MAX_ENTRIES:
            accepted = False
        elif pending is not None:
            if entry_match is not None or len(line.text) > MAX_ENTRY_CHARACTERS:
                return False
            taken.append(ContentsEntry(pending, line.text, block.id, f"{pending_text} {line.text}"))
            pending = None
            expected += 1
            continuing = not line.text.endswith(_SENTENCE_END)
        elif entry_match is not None:
            title = entry_match.group(2)
            if int(entry_match.group(1)) != expected or len(title) > MAX_ENTRY_CHARACTERS:
                accepted = False
            else:
                taken.append(ContentsEntry(expected, title, block.id, line.text))
                expected += 1
                continuing = not title.endswith(_SENTENCE_END)
        elif lone is not None and int(lone.group(1)) == expected:
            pending = expected
            pending_text = line.text
            continuing = False
        elif (
            continuing
            and (taken or cursor.entries)
            and (position > 0 or not block.bold)
            and len(line.text)
            <= (MAX_ENTRY_CHARACTERS if position else MAX_CONTINUATION_CHARACTERS)
            and _LEAFLET_SECTION.match(title_key(_unnumbered(line.text))) is None
        ):
            previous = taken[-1] if taken else (carried or cursor.entries[-1])
            joined = previous.continued(line.text)
            if taken:
                taken[-1] = joined
            else:
                carried = joined
            continuing = not line.text.endswith(_SENTENCE_END)
        else:
            title = _unnumbered(line.text)
            key = title_key(title)
            if (
                (cursor.entries or taken or cursor.has_header)
                and expected <= TOLERANT_LIMIT
                and (block.kind in _TOLERANT_KINDS or _LEAFLET_SECTION.match(key) is not None)
                and not block.bold
                and len(lines) == 1
                and len(title) <= MAX_ENTRY_CHARACTERS
                and key
                and key not in cursor.seen_keys
            ):
                taken.append(ContentsEntry(expected, title, block.id, line.text))
                expected += 1
                continuing = not title.endswith(_SENTENCE_END)
            else:
                accepted = False
        if not accepted:
            if not taken or pending is not None:
                return False
            cut = base + line.start
            break
    if carried is not None:
        cursor.entries[-1] = carried
    cursor.entries.extend(taken)
    cursor.block_ids.append(block.id)
    cursor.expected = expected
    cursor.pending_number = pending
    cursor.pending_text = pending_text
    cursor.seen_keys.update(title_key(entry.title) for entry in taken)
    if cut is not None:
        cursor.split = (block.id, cut)
    return True


def _repeated_titles(entries: Sequence[ContentsEntry], later: Sequence[str]) -> int:
    """Entries whose title comes back in the text after the list (heading or running text)."""
    later_text = " ".join(title_key(text) for text in later if text.strip())
    return sum(1 for entry in entries if (key := title_key(entry.title)) and key in later_text)


def _inline_header(block: ExtractedBlock) -> re.Match[str] | None:
    """The «Содержание …» header with the first entry right behind it inside a longer block."""
    if block.kind not in {"paragraph", "list", "table_candidate"}:
        return None
    for match in _INLINE_HEADER.finditer(block.text):
        if not block.text[match.start()].isupper():
            continue
        before = block.text[: match.start()].rstrip(" \t")
        if not before or before.endswith(("\n", ".", "!", "?", "»", ")")):
            return match
    return None


def _run_from(
    blocks: Sequence[ExtractedBlock],
    start: int,
    header_id: str | None,
    *,
    inline: re.Match[str] | None = None,
) -> tuple[ContentsRun, int] | None:
    """The run that begins at ``blocks[start]`` (just behind its header block, or inside the block
    when ``inline`` is the header found in it)."""
    cursor = _Cursor(has_header=header_id is not None or inline is not None)
    index = start
    head: tuple[str, int] | None = None
    lead: str | None = None
    rest_text = ""
    if inline is not None:
        first = blocks[start]
        pseudo = first.model_copy(update={"text": first.text[inline.end() :]})
        if not _consume_block(pseudo, cursor, base=inline.end()):
            return None
        head = (first.id, inline.start())
        lead = first.text[inline.start() : inline.end()].strip()
        index += 1
    while index < len(blocks) and cursor.split is None and _consume_block(blocks[index], cursor):
        index += 1
    if cursor.pending_number is not None:
        return None
    entries = tuple(cursor.entries)
    has_header = header_id is not None or inline is not None
    minimum = MIN_ENTRIES if has_header else MIN_ENTRIES_WITHOUT_HEADER
    if len(entries) < minimum:
        return None
    if cursor.split is not None:
        split_block = blocks[index - 1]
        rest_text = split_block.text[cursor.split[1] :]
    later = [rest_text, *(block.text for block in blocks[index:])]
    repeated = _repeated_titles(entries, later)
    if not has_header:
        # Without the header, only a list of the leaflet's own sections qualifies (a numbered list
        # of steps that the text repeats is not a table of contents).
        sections = sum(1 for entry in entries if _LEAFLET_SECTION.match(title_key(entry.title)))
        if repeated < len(entries) or sections < MIN_LEAFLET_SECTIONS:
            return None
    elif repeated < MIN_REPEATED_SHARE * len(entries):
        return None
    return (
        ContentsRun(
            header_id=header_id,
            block_ids=tuple(cursor.block_ids),
            entries=entries,
            repeated=repeated,
            split=cursor.split,
            head=head,
            lead=lead,
        ),
        index,
    )


def find_contents_runs(blocks: Sequence[ExtractedBlock]) -> list[ContentsRun]:
    """The contents lists of a document. ``blocks`` are its kept blocks in reading order."""
    runs: list[ContentsRun] = []
    index = 0
    while index < len(blocks):
        block = blocks[index]
        found: tuple[ContentsRun, int] | None = None
        inline = _inline_header(block)
        if block.kind in {"paragraph", "heading"} and is_contents_header(block.text):
            found = _run_from(blocks, index + 1, block.id)
        elif inline is not None:
            found = _run_from(blocks, index, None, inline=inline)
        elif block.kind in {"list", "paragraph"}:
            lines = block_lines(block)
            first = _ENTRY.match(lines[0].text) if lines else None
            if first is not None and int(first.group(1)) == 1:
                found = _run_from(blocks, index, None)
        if found is None:
            index += 1
            continue
        run, end = found
        runs.append(run)
        index = end
    return runs
