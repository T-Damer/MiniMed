"""How often each sense of an ambiguous term is used across all клинические рекомендации.

«Депрессия» is a psychiatric disorder in nearly every recommendation and a fracture pattern in a
few traumatology ones. A dictionary that lists both must put the first one first. The signal is
measured from the corpus itself, deterministically:

1. every paragraph of every current recommendation is reduced to word stems (a fixed-length
   prefix, no morphology library);
2. each sense of a term brings the stems of its own definition as its *context*; stems that
   several senses of the same term share count a quarter as much, rare stems (inverse paragraph
   frequency) count more;
3. a paragraph that contains the term is given to the sense whose context it overlaps most,
   provided the overlap is strong and clearly beats the runner-up; otherwise it is unassigned;
4. a sense's `usage` is the number of recommendations with at least one paragraph given to it,
   `termUsage` the number of recommendations that use the term at all.

Glossary, abbreviation and bibliography sections are not scanned, so a sense is never counted by
the very paragraph that defines it. Nothing here reads, paraphrases or generates definition text;
the numbers only order senses.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from .kr_fields import field_for_mkb_codes
from .kr_registry_glossary import read_registry_document, section_paragraphs

SKIPPED_SECTIONS = frozenset(
    ["doc_whole", "doc_terms", "doc_abbreviation", "doc_bible", "doc_a1", "doc_title"]
)
MIN_STEM_LETTERS = 4
# A paragraph is given to a sense only on at least this much weighted context overlap …
MIN_ASSIGN_SCORE = 10.0
# … from at least this many context stems that are each distinctive enough (weight ≥ STRONG) …
MIN_STRONG_STEMS = 2
STRONG_WEIGHT = 4.0
# … and when it beats the next sense by this factor.
MIN_ASSIGN_MARGIN = 1.25
SHARED_CONTEXT_FACTOR = 0.25
# Two senses whose weighted stem overlap reaches this are the same meaning.
CLUSTER_SIMILARITY = 0.08

_TOKEN = re.compile(r"[^\W\d_]+", re.UNICODE)
_IMAGE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_BRACKETS = re.compile(r"\([^()]*\)|\[[^\[\]]*\]")


def stem(token: str) -> str:
    """Fixed-prefix stem: endings of Russian inflection are dropped, nothing else."""
    word = token.lower().replace("ё", "е")
    if len(word) >= 6:
        return word[:5]
    if len(word) == 5:
        return word[:4]
    return word


def stems(text: str) -> list[str]:
    """Stems of the words of a text (words of fewer than three letters are dropped)."""
    return [stem(token) for token in _TOKEN.findall(text) if len(token) >= 3]


def term_stems(title: str) -> tuple[str, ...]:
    """Stems of a headword without its bracketed parts; empty when it is not scannable."""
    sequence = tuple(stems(_BRACKETS.sub(" ", title)))
    if not sequence or max(len(item) for item in sequence) < MIN_STEM_LETTERS:
        return ()
    return sequence


@dataclass(frozen=True)
class CorpusDocument:
    code_version: str
    field: str | None
    paragraphs: tuple[tuple[str, ...], ...]


@dataclass
class Corpus:
    documents: list[CorpusDocument] = field(default_factory=list)
    paragraph_frequency: Counter[str] = field(default_factory=Counter)
    paragraph_count: int = 0

    def add(self, document: CorpusDocument) -> None:
        self.documents.append(document)
        for paragraph in document.paragraphs:
            self.paragraph_count += 1
            self.paragraph_frequency.update(set(paragraph))

    def idf(self, word: str) -> float:
        """Inverse paragraph frequency; unseen stems count as the rarest seen."""
        frequency = self.paragraph_frequency.get(word, 1)
        return math.log((self.paragraph_count + 1) / frequency)


def load_registry_corpus(root: Path, raw: Path) -> Corpus:
    """Current editions of every recommendation in the raw registry JSON, reduced to stems."""
    import json

    corpus = Corpus()
    for path in sorted((root / raw).glob("*.json")):
        document = read_registry_document(path, root)
        if not document.current:
            continue
        payload = json.loads(path.read_bytes())
        sections = payload.get("obj", {}).get("sections") or []
        paragraphs: list[tuple[str, ...]] = []
        for section in sections:
            if section.get("id") in SKIPPED_SECTIONS:
                continue
            html = _IMAGE.sub(" ", str(section.get("content") or ""))
            for paragraph in section_paragraphs(html):
                reduced = tuple(stems(paragraph.text))
                if reduced:
                    paragraphs.append(reduced)
        corpus.add(
            CorpusDocument(
                document.code_version, field_for_mkb_codes(document.mkb), tuple(paragraphs)
            )
        )
    return corpus


@dataclass(frozen=True)
class SenseText:
    """One sense of a term: the stable key of its entry and the definition text."""

    key: str
    text: str


@dataclass(frozen=True)
class SenseUsage:
    usage: int
    occurrences: int
    #: Index of the meaning (cluster of alike-worded senses) within the headword.
    meaning: int = 0


@dataclass(frozen=True)
class TermUsage:
    term_usage: int
    senses: Mapping[str, SenseUsage]


def _stem_sets(
    title_stems: Iterable[str], senses: Sequence[SenseText]
) -> dict[str, frozenset[str]]:
    own = set(title_stems)
    return {
        sense.key: frozenset(
            item for item in stems(sense.text) if item not in own and len(item) >= MIN_STEM_LETTERS
        )
        for sense in senses
    }


def _similarity(left: frozenset[str], right: frozenset[str], corpus: Corpus) -> float:
    """Inverse-frequency weighted Jaccard overlap of two stem sets."""
    union = left | right
    if not union:
        return 0.0
    return sum(corpus.idf(item) for item in left & right) / sum(corpus.idf(item) for item in union)


def cluster_senses(stem_sets: Mapping[str, frozenset[str]], corpus: Corpus) -> list[list[str]]:
    """Senses worded alike are one meaning (the same definition cited by several sources).

    Greedy single pass in key order: a sense joins the first cluster whose pooled context it
    resembles, otherwise it starts a new one. Usage is measured per cluster, so a meaning that
    several sources define is not split into rivals that each look rare.
    """
    clusters: list[tuple[list[str], set[str]]] = []
    for key, words in stem_sets.items():
        for members, pooled in clusters:
            if _similarity(words, frozenset(pooled), corpus) >= CLUSTER_SIMILARITY:
                members.append(key)
                pooled.update(words)
                break
        else:
            clusters.append(([key], set(words)))
    return [members for members, _ in clusters]


def _context(
    title_stems: Iterable[str], senses: Sequence[SenseText], corpus: Corpus
) -> tuple[dict[str, dict[str, float]], dict[str, str], dict[str, int]]:
    """Weighted context per meaning cluster, the cluster of each sense and its meaning index."""
    stem_sets = _stem_sets(title_stems, senses)
    clusters = cluster_senses(stem_sets, corpus)
    cluster_of = {key: members[0] for members in clusters for key in members}
    meaning_of = {key: index for index, members in enumerate(clusters) for key in members}
    pooled = {
        members[0]: frozenset().union(*(stem_sets[key] for key in members)) for members in clusters
    }
    shared = Counter(item for items in pooled.values() for item in items)
    context = {
        name: {
            item: corpus.idf(item) * (SHARED_CONTEXT_FACTOR if shared[item] > 1 else 1.0)
            for item in items
        }
        for name, items in pooled.items()
    }
    return context, cluster_of, meaning_of


def measure_usage(
    corpus: Corpus, groups: Mapping[str, tuple[str, Sequence[SenseText]]]
) -> dict[str, TermUsage]:
    """Usage of every sense of every term group; a group is `(title, senses)` under its key.

    Only groups whose title can be scanned (a stem of four or more letters) are measured.
    """
    index: dict[str, list[tuple[str, tuple[str, ...]]]] = defaultdict(list)
    contexts: dict[str, dict[str, dict[str, float]]] = {}
    cluster_of: dict[str, dict[str, str]] = {}
    meaning_of: dict[str, dict[str, int]] = {}
    for group_key, (title, senses) in groups.items():
        sequence = term_stems(title)
        if not sequence or len(senses) < 2:
            continue
        index[sequence[0]].append((group_key, sequence))
        contexts[group_key], cluster_of[group_key], meaning_of[group_key] = _context(
            sequence, senses, corpus
        )
    term_documents: dict[str, set[str]] = defaultdict(set)
    assigned: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    occurrences: dict[str, Counter[str]] = defaultdict(Counter)
    for document in corpus.documents:
        for paragraph in document.paragraphs:
            seen: set[str] = set()
            for position, word in enumerate(paragraph):
                for group_key, sequence in index.get(word, ()):
                    if group_key in seen:
                        continue
                    if paragraph[position : position + len(sequence)] != sequence:
                        continue
                    seen.add(group_key)
                    term_documents[group_key].add(document.code_version)
                    best = _assign(contexts[group_key], set(paragraph))
                    if best is not None:
                        assigned[group_key][best].add(document.code_version)
                        occurrences[group_key][best] += 1
    return {
        group_key: TermUsage(
            len(term_documents.get(group_key, ())),
            {
                sense.key: SenseUsage(
                    len(assigned[group_key].get(cluster_of[group_key][sense.key], ())),
                    occurrences[group_key][cluster_of[group_key][sense.key]],
                    meaning_of[group_key][sense.key],
                )
                for sense in groups[group_key][1]
            },
        )
        for group_key in contexts
    }


def _assign(context: Mapping[str, Mapping[str, float]], present: set[str]) -> str | None:
    scored: list[tuple[float, int, str]] = []
    for key, words in context.items():
        weights = [weight for item, weight in words.items() if item in present]
        scored.append((sum(weights), sum(1 for w in weights if w >= STRONG_WEIGHT), key))
    scored.sort(reverse=True)
    best_score, strong, best_key = scored[0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0
    if (
        best_score < MIN_ASSIGN_SCORE
        or strong < MIN_STRONG_STEMS
        or best_score < runner_up * MIN_ASSIGN_MARGIN
    ):
        return None
    return best_key
