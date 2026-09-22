"""Apply the inspected source-layout repairs to the new journal adapter only."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'tools/ingest/src/localmed_ingest/specialist_journal_reference.py'
s = path.read_text()
a = s.index('def definition_label(')
b = s.index('\ndef _geometry(', a)
s = s[:a] + '''def definition_label(value: str) -> str | None:
    cleaned = LEADING_NUMBER.sub('', compact(value))
    match = DEFINITION.match(cleaned)
    if not match:
        return None
    label = match[1].strip().rstrip('.,')
    if (BAD_START.search(label) or len(label.split()) > 16 or
        any(c in label for c in '.:;!?') or
        re.search(r'\\b(?:чаще|реже|обычно|часто|гистологически|преимущественно)$', label, re.I) or
        re.search(r'\\b(?:в возрасте|в большинстве|в \\d|случаев)', label, re.I)):
        return None
    if (re.match(r'^(?:цель|наличие|настоящий этап|длительность|патофизиологическая основа|'
                 r'психолингвисты|ведущие клинические|заболевание$)', label, re.I) or
        label.lower() in {'классификация', 'острое течение', 'патогенез', 'диагностика'}):
        return None
    if not re.match('[А-Яа-яЁёA-Za-z«]', label) or not re.search('[а-яё]', label, re.I):
        return None
    if label.count('(') != label.count(')') or label.count('«') != label.count('»'):
        return None
    return label


def definition_probes(body: str) -> list[tuple[str, str]]:
    # Only explicit sentence boundaries inside source text. The original whole block
    # remains context; a derived sentence is labelled as a source excerpt, not rewritten.
    probes = [body]
    probes.extend(part for part in body.splitlines() if part.strip())
    if len(body) > 1000:
        probes.extend(re.split(r'(?<=[.!?])\\s+(?=[А-ЯЁ«])', body))
    result: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for probe in probes:
        label = definition_label(probe)
        if label is None:
            intro = re.match(r'^([А-ЯЁ][а-яёА-ЯЁ -]{2,99}) включает следующие симптомы:$', probe)
            label = intro[1] if intro else None
        if label and (label, probe) not in seen:
            result.append((label, probe))
            seen.add((label, probe))
    return result

''' + s[b:]
a = s.index('def source_units(')
b = s.index('\ndef proposed_kind(', a)
s = s[:a] + '''def source_units(fragment: str, container: str) -> tuple[list[Unit], dict[str, int]]:
    tree = SourceHtml(fragment).root
    units: list[Unit] = []
    omissions: dict[str, int] = {}
    headings: list[tuple[int, str]] = []
    atomic = {'p', 'ol', 'ul', 'dl', 'table', 'blockquote', 'pre'}
    inline_tags = {'a', 'b', 'strong', 'i', 'em', 'u', 'span', 'font', 'sup', 'sub',
                   'small', 'nobr', 'br', 's', 'strike', 'code', 'mark', 'q'}

    def append(body: str, locator: str, tag: str, tables: list[object],
               probes: list[tuple[str, str]] | None = None) -> None:
        if body:
            units.append(Unit(body, locator, tuple(v for _, v in headings), tag, tables,
                              definition_probes(body) if probes is None else probes))

    def walk(node: Element | str, locator: str) -> None:
        if isinstance(node, str):
            append(node.strip(), locator, 'text', [])
            return
        if omitted(node):
            key = 'media' if node.tag in {'img', 'svg', 'figure', 'audio', 'video'} else 'layout'
            omissions[key] = omissions.get(key, 0) + 1
            return
        if node.tag in {'iframe', 'object', 'embed', 'canvas'}:
            raise ValueError('Embedded source material needs separate extraction review')
        if re.fullmatch(r'h[1-6]', node.tag):
            label = compact(render(node))
            if label:
                depth = int(node.tag[1])
                while headings and headings[-1][0] >= depth:
                    headings.pop()
                headings.append((depth, label))
                append(label, locator, 'heading', [], [])
            return
        if node.tag in atomic:
            body = compact(render(node))
            for tag in ('iframe', 'object', 'embed', 'canvas'):
                if descendants(node, tag):
                    raise ValueError('Embedded source material needs separate extraction review')
            for tag in ('img', 'svg', 'figure', 'audio', 'video'):
                omissions['media'] = omissions.get('media', 0) + len(descendants(node, tag))
            probes = definition_probes(body) if node.tag != 'table' else []
            if node.tag in {'ol', 'ul'}:
                probes = [pair for li in descendants(node, 'li')
                          for pair in definition_probes(compact(render(li)))]
            append(body, locator, node.tag, _geometry(node), probes)
            return
        # Legacy journal pages have plain text interrupted by reference anchors. Never
        # turn a citation number, comma, or emphasized word into a separate source block.
        pending: list[Element | str] = []
        first = 0

        def flush() -> None:
            if pending:
                append(compact(''.join(render(child) for child in pending)),
                       f'{locator}/inline[{first}]', 'inline-run', [])
                pending.clear()

        for index, child in enumerate(node.children):
            is_inline = isinstance(child, str) or (child.tag in inline_tags and
                not any(descendants(child, tag) for tag in (*atomic, 'div', 'h2', 'h3', 'h4')))
            if is_inline:
                if not pending:
                    first = index
                pending.append(child)
            else:
                flush()
                walk(child, f'{locator}/{node.tag}[{index}]')
        flush()

    walk(tree, container)
    if not units or len(units) > 1000 or any(len(u.body) > 262144 for u in units):
        raise ValueError('Source unit budget exceeded or no readable full text')
    return units, omissions

''' + s[b:]
s = s.replace('for label, evidence in labels:', 'for label, evidence in labels:')
old = '            records.append(\n                {\n                    "id": stem + ".entry."'
assert old in s
new = '''            selected_number = number
            if evidence != unit.body and evidence in unit.body:
                offset = unit.body.index(evidence)
                derived = {**blocks[number - 1], 'id': len(blocks) + 1, 'text': evidence,
                           'textSha256': digest(evidence),
                           'locator': unit.locator + f'; codepoints={offset}:{offset + len(evidence)}',
                           'sourceSpan': {'parentBlock': number, 'start': offset,
                                          'end': offset + len(evidence)}}
                blocks.append(derived)
                selected_number = len(blocks)
                if number not in related:
                    related.insert(0, number)
                start = evidence.index(label)
            symptom_list = evidence.endswith(' включает следующие симптомы:')
            if symptom_list and (index + 1 >= len(body) or body[index + 1].tag not in {'ol', 'ul'}):
                continue
            records.append(
                {
                    "id": stem + ".entry."'''
s = s.replace(old,new)
# Replace the occurrence in a term, not the earlier article overview.
s = s.replace('"blockIds": [number],', '"blockIds": [selected_number],')
s = s.replace('"block": number,\n', '"block": selected_number,\n')
s = s.replace('"coverage": "section-excerpt"\n                    if unit.tag == "heading"\n                    else "explicit-definition",', '"coverage": ("criterion-list" if symptom_list else\n                        "section-excerpt" if unit.tag == "heading" else "explicit-definition"),')
s = s.replace('or ""', 'or ""')
# Isolated repairs to formatting/type diagnostics; the literal text values are unchanged.
s = s.replace('"archiveBoundary": "Publisher metadata and exact serialized article DOM fragments, not site chrome or cookies.",', '"archiveBoundary": ("Publisher metadata and exact serialized article DOM fragments, "\n                            "not site chrome or cookies."),')
s = s.replace('"changes": "HTML to plain text, whitespace normalization, explicit list markers and physical table geometry. No medical rewriting, translation or scoring.",', '"changes": ("HTML to plain text, whitespace normalization, explicit list markers "\n                    "and physical table geometry. No medical rewriting, translation or scoring."),')
s = s.replace('"applicability": "Author discussion at the publication date; not automatically a current guideline.",', '"applicability": ("Author discussion at the publication date; "\n                          "not automatically a current guideline."),')
# Avoid generic procedural headings posing as separate concepts.
s = s.replace('and not GENERIC_HEADINGS.search(unit.body)', 'and not GENERIC_HEADINGS.search(unit.body)\n            and not re.match(r"^(?:классификация$|патогенез|тактика|лечение|терапия)", unit.body, re.I)')
path.write_text(s)
path=root/'tools/ingest/src/localmed_ingest/specialist_journal_collect.py'
s=path.read_text().replace('from pathlib import Path', 'from pathlib import Path\nfrom http.client import HTTPMessage\nfrom typing import IO')
s=s.replace('fp: object,','fp: IO[bytes],').replace('headers: object,','headers: HTTPMessage,')
phrases=[
 ('Original full article sections, not abstracts. Author-specific dates and frames retained. Proposed headings/definition clauses are not reviewed canonical concepts. No clinical scoring, Wikipedia, private input, model or release.', ['Original full article sections, not abstracts. Author-specific dates and frames retained. ', 'Proposed headings/definition clauses are not reviewed canonical concepts. ', 'No clinical scoring, Wikipedia, private input, model or release.']),
 ('Each records file preserves the article authors, journal, original page, DOI, publication date, ', ['Each records file preserves the article authors, journal, original page, ', 'DOI, publication date, ']),
 ('CC BY-NC-SA sources are noncommercial and share-alike; this is a local development research collection, ', ['CC BY-NC-SA sources are noncommercial and share-alike; ', 'this is a local development research collection, ']),
 ('Changes: extraction of article-only DOM fragments, HTML-to-text formatting, whitespace normalization, ', ['Changes: extraction of article-only DOM fragments, HTML-to-text formatting, ', 'whitespace normalization, ']),
 ('No medical rewriting, translation, modernized consensus, approved scoring or endorsement by authors. ', ['No medical rewriting, translation, modernized consensus, approved scoring ', 'or endorsement by authors. '])]
for old,parts in phrases:
    s=s.replace('"'+old+'"', '('+'\n'.join('"'+p+'"' for p in parts)+')' if old.startswith('Original') else '\n            '.join('"'+p+'"' for p in parts))
path.write_text(s)
path=root/'tools/ingest/tests/test_specialist_journal_reference.py'
s=path.read_text().replace('content="Synthetic source"><meta', 'content="Synthetic source">\n<meta').replace('content="Автор примера"><meta', 'content="Автор примера">\n<meta')
path.write_text(s)
