"""Finds mentions of known concepts/aliases in definition texts (automatic wikilinks).

Two modes:
  exact - normalized word sequence equals a known title/alias;
  stem  - each word ≥5 letters may carry up to 4 extra letters after dropping its last 2
          (crude Russian inflection: «сахарный диабет» ↔ «сахарным диабетом»).
Uppercase abbreviations (≥2 letters, e.g. «ЭКГ») match case-sensitively and exactly.
Forms shorter than 3 letters that are not abbreviations are ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

TOKEN = re.compile(r"\w+(?:-\w+)*")


def fold(w: str) -> str:
    return w.casefold().replace("ё", "е")


def is_abbrev(form: str) -> bool:
    letters = [c for c in form if c.isalpha()]
    return (
        len(letters) >= 2
        and all(c.isupper() for c in letters)
        and " " not in form.strip()
    )


def stem(w: str) -> str:
    return w if len(w) < 5 else w[: max(4, len(w) - 2)]


@dataclass(frozen=True)
class Form:
    words: tuple[str, ...]  # folded (or raw for abbreviations)
    target: str  # concept key
    abbrev: bool


class Linker:
    def __init__(self, forms: dict[str, str], mode: str = "stem") -> None:
        """forms: surface form -> concept key."""
        self.mode = mode
        self.index: dict[str, list[Form]] = {}
        for surface, target in forms.items():
            ab = is_abbrev(surface)
            words = TOKEN.findall(surface)
            if not words:
                continue
            if not ab and len("".join(words)) < 3:
                continue
            ws = tuple(words) if ab else tuple(fold(w) for w in words)
            f = Form(ws, target, ab)
            key = ws[0] if (ab or mode == "exact") else stem(ws[0])
            self.index.setdefault(key, []).append(f)
        for v in self.index.values():
            v.sort(key=lambda f: -len(f.words))

    def _word_ok(self, form_word: str, tok: str, ab: bool) -> bool:
        if ab:
            return form_word == tok
        t = fold(tok)
        if self.mode == "exact" or len(form_word) < 5:
            return t == form_word
        s = stem(form_word)
        return t.startswith(s) and len(t) - len(s) <= 4

    def find(self, text: str) -> list[tuple[int, int, str]]:
        """Non-overlapping (start, end, target), longest match first."""
        toks = [(m.start(), m.end(), m.group(0)) for m in TOKEN.finditer(text)]
        out = []
        i = 0
        while i < len(toks):
            tok = toks[i][2]
            cands: list[Form] = []
            cands += self.index.get(tok, [])
            ft = fold(tok)
            if self.mode == "exact":
                if ft != tok:
                    cands += self.index.get(ft, [])
            else:
                if len(ft) < 5:
                    cands += self.index.get(ft, [])
                else:
                    for k in range(4, len(ft) + 1):
                        if len(ft) - k <= 4:
                            cands += self.index.get(ft[:k], [])
            best = None
            for f in sorted(cands, key=lambda f: -len(f.words)):
                n = len(f.words)
                if i + n > len(toks):
                    continue
                if all(
                    self._word_ok(f.words[j], toks[i + j][2], f.abbrev)
                    for j in range(n)
                ):
                    best = f
                    break
            if best:
                n = len(best.words)
                out.append((toks[i][0], toks[i + n - 1][1], best.target))
                i += n
            else:
                i += 1
        return out
