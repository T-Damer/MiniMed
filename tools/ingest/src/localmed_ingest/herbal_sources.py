"""Fetch the raw sources of the herbal book («Травник») into ``data/raw/herbal``.

* EMA/HMPC: the herbal page of each plant and its English PDFs — the current EU herbal monograph
  (or public statement), the assessment report and the public summary. EMA notice: «Reproduction
  is authorised provided the source is acknowledged».
* Wikimedia Commons: one botanical plate per plant at 1600 px. The licence is read from the file's
  Commons metadata and anything that is not public domain is refused.
* ГФ XV general monograph «Настои и отвары» (ОФС.1.4.1.0018): the article page, whose HTML holds
  the text, and the order that approved it.
* Two pharmacognosy teaching texts (НФаУ 2016, СибГМУ 2013) whose admixture tables name
  look-alikes (owner decision 2026-10-19).
* The ГФ raw-material article (ФС) of every plant — ГФ XV, else the ГФ XIV article still in force:
  definition (when and what is collected), appearance of the whole raw material, look-alikes.

``MANIFEST.json`` records every URL, SHA-256 and fetch time. A file already on disk is kept, so the
reviewed bytes never change silently; ``--refresh`` re-downloads and fails when the bytes changed.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

from .herbal_plants import Plant, load_plants

MANIFEST_NAME = "MANIFEST.json"
EMA_BASE = "https://www.ema.europa.eu"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
PLATE_WIDTH = 1600
GF15_BASE = "https://pharmacopoeia.regmed.ru"
# Only «Настои и отвары» carries home-preparation rules; the other dosage-form articles (настойки,
# сборы, экстракты) are laboratory quality control. The article text is in the page HTML; the one
# PDF the page links is the approving order.
GF15_ARTICLES = {
    "nastoi-i-otvary": "/pharmacopoeia/izdanie-15/1/1-4/1-4-1-lekarstvennye-formy/nastoi-i-otvary/",
}
# pharmacopoeia.regmed.ru serves its leaf certificate without the GlobalSign intermediate. The
# intermediate named in the leaf's AIA field is added to the verify store; the chain must still end
# at a system-trusted GlobalSign root (partial chains stay disabled).
GF15_INTERMEDIATE_URL = "http://secure.globalsign.com/cacert/gsgccr3dvtlsca2020.crt"
PUBLIC_DOMAIN_LICENCES = frozenset({"public domain", "pd", "cc0", "pd-old", "pd-art"})
_USER_AGENT = "MiniMed-ingest/0.3 (offline medical reference; personal project)"
_MAX_BYTES = 96 * 1024 * 1024
_EMA_PDF = re.compile(r'href="(/en/documents/[a-z-]+/[^"]+_en\.pdf)"')
_MONOGRAPH_NAME = re.compile(r"^(?:final-)?(?:european-union|community)-herbal-monograph-")
_DRAFT_MONOGRAPH_NAME = re.compile(r"^draft-(?:european-union|community)-herbal-monograph-")
_STATEMENT_NAME = re.compile(r"^(?:final-)?public-statement-")
_REVISION = re.compile(r"revision-(\d+)")
_GF_ORDER = re.compile(r'href="(/upload/iblock/[^"]+\.pdf)">([^<]+)</a>')
_LAST_UPDATED = re.compile(r"Last updated[^0-9]{0,200}?(\d{2}/\d{2}/\d{4})", re.S)


@dataclass(frozen=True)
class RawFile:
    path: str
    url: str
    sha256: str
    size_bytes: int
    fetched_at: str


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


_contexts: dict[str, ssl.SSLContext] = {}


def _context_for(url: str) -> ssl.SSLContext | None:
    if urllib.parse.urlsplit(url).netloc != urllib.parse.urlsplit(GF15_BASE).netloc:
        return None
    if "gf15" not in _contexts:
        context = ssl.create_default_context()
        context.verify_flags &= ~ssl.VERIFY_X509_PARTIAL_CHAIN
        context.load_verify_locations(cadata=_download(GF15_INTERMEDIATE_URL))
        _contexts["gf15"] = context
    return _contexts["gf15"]


def _download(url: str, *, attempts: int = 6) -> bytes:
    last: Exception | None = None
    context = _context_for(url)
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(request, timeout=120, context=context) as response:
                payload = cast("bytes", response.read(_MAX_BYTES + 1))
            if len(payload) > _MAX_BYTES:
                raise ValueError(f"{url} is larger than {_MAX_BYTES} bytes")
            return payload
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504):
                raise
            last = error
            time.sleep((30 if error.code == 429 else 5) * (attempt + 1))
        except (OSError, urllib.error.URLError) as error:
            last = error
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"download failed after {attempts} attempts: {url}") from last


class _Store:
    def __init__(self, root: Path, refresh: bool) -> None:
        self.root = root
        self.refresh = refresh
        manifest = root / MANIFEST_NAME
        previous: dict[str, object] = (
            json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
        )
        files = previous.get("files")
        self.files: dict[str, dict[str, object]] = {}
        if isinstance(files, list):
            for item in cast("list[dict[str, object]]", files):
                self.files[str(item["path"])] = item

    def save(
        self, relative: str, url: str, fetch: bytes | None = None, *, pinned: bool = True
    ) -> RawFile:
        """Store one file. A ``pinned`` file is never replaced by different bytes; listing pages
        (``pinned=False``) are refreshed on every run, since only the documents they link matter."""
        target = self.root / relative
        known = self.files.get(relative)
        if pinned and known is not None and target.exists() and not self.refresh:
            return RawFile(
                relative,
                str(known["url"]),
                str(known["sha256"]),
                int(cast("int", known["sizeBytes"])),
                str(known["fetchedAt"]),
            )
        payload = fetch if fetch is not None else _download(url)
        sha256 = hashlib.sha256(payload).hexdigest()
        if pinned and known is not None and known["sha256"] != sha256:
            raise ValueError(
                f"{relative}: the source now serves different bytes than the reviewed copy"
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".part")
        temporary.write_bytes(payload)
        temporary.replace(target)
        record = RawFile(relative, url, sha256, len(payload), _now())
        self.files[relative] = {
            "path": record.path,
            "url": record.url,
            "sha256": record.sha256,
            "sizeBytes": record.size_bytes,
            "fetchedAt": record.fetched_at,
        }
        return record

    def write_manifest(self, extra: dict[str, object]) -> dict[str, object]:
        manifest: dict[str, object] = {
            "schemaVersion": 1,
            **extra,
            "files": [self.files[key] for key in sorted(self.files)],
        }
        (self.root / MANIFEST_NAME).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return manifest


def select_ema_documents(page_html: str) -> dict[str, str]:
    """Pick the current English documents linked from an EMA herbal page.

    EMA names files ``final-…``, ``…`` (no prefix), ``draft-…`` and ``superseded-…``. Current means
    neither draft nor superseded. ``monograph``: the current EU herbal monograph with the highest
    revision, else the newest draft monograph (flagged by the caller); ``public-statement``: the
    current public statement; ``assessment-report``: the current report with the highest revision,
    else the newest draft; ``summary``: the public (lay) summary.
    """

    links = sorted({match for match in _EMA_PDF.findall(page_html)})

    def revision(link: str) -> int:
        found = _REVISION.search(link)
        return int(found.group(1)) if found else 0

    def newest(candidates: list[str]) -> str | None:
        return max(candidates, key=revision) if candidates else None

    def name(link: str) -> str:
        return link.rsplit("/", 1)[1]

    def current(link: str) -> bool:
        return not name(link).startswith(("draft-", "superseded-"))

    chosen: dict[str, str] = {}
    # EMA sometimes files the monograph under another folder (e.g. herbal-opinion), so match names.
    monographs = [link for link in links if _MONOGRAPH_NAME.match(name(link))]
    drafts = [link for link in links if _DRAFT_MONOGRAPH_NAME.match(name(link))]
    # A plant whose only monograph is still a draft keeps it, flagged as a draft by the caller.
    if (picked := newest(monographs) or newest(drafts)) is not None:
        chosen["monograph"] = picked
    statements = [link for link in links if _STATEMENT_NAME.match(name(link))]
    if (picked := newest(statements)) is not None:
        chosen["public-statement"] = picked
    reports = [
        link for link in links if re.match(r"^(?:draft-|final-)?assessment-report-", name(link))
    ]
    final_reports = [link for link in reports if current(link)]
    if (picked := newest(final_reports) or newest(reports)) is not None:
        chosen["assessment-report"] = picked
    summaries = [link for link in links if "/herbal-summary/" in link]
    if summaries:
        chosen["summary"] = summaries[0]
    if "monograph" not in chosen and "public-statement" not in chosen:
        raise ValueError(
            f"EMA page links neither a current monograph nor a public statement: {links}"
        )
    return chosen


def _ema_last_updated(page_html: str) -> str | None:
    text = re.sub(r"<[^>]+>", " ", page_html)
    found = _LAST_UPDATED.search(html.unescape(text))
    return found.group(1) if found else None


def _fetch_ema(store: _Store, plant: Plant) -> dict[str, object]:
    slug = plant.ema.slug
    page_bytes = _download(plant.ema.page)
    page = store.save(f"ema/{slug}/page.html", plant.ema.page, page_bytes, pinned=False)
    page_html = (store.root / page.path).read_text(encoding="utf-8")
    documents: dict[str, object] = {}
    for kind, link in select_ema_documents(page_html).items():
        url = EMA_BASE + link
        saved = store.save(f"ema/{slug}/{kind}.pdf", url)
        documents[kind] = {
            "path": saved.path,
            "url": url,
            "draft": link.rsplit("/", 1)[1].startswith("draft-"),
        }
    return {
        "page": plant.ema.page,
        "lastUpdated": _ema_last_updated(page_html),
        "documents": documents,
    }


def _commons_plate_info(title: str) -> dict[str, object]:
    query = urllib.parse.urlencode(
        {
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|size|mime|sha1|extmetadata",
            "iiurlwidth": str(PLATE_WIDTH),
            "format": "json",
        }
    )
    data = json.loads(_download(f"{COMMONS_API}?{query}"))
    pages = cast("dict[str, dict[str, object]]", data["query"]["pages"])
    page = next(iter(pages.values()))
    if "imageinfo" not in page:
        raise ValueError(f"Commons has no file {title}")
    return cast("list[dict[str, object]]", page["imageinfo"])[0]


def _meta(info: dict[str, object], key: str) -> str | None:
    extmetadata = cast("dict[str, dict[str, object]]", info.get("extmetadata") or {})
    value = extmetadata.get(key, {}).get("value")
    if not isinstance(value, str):
        return None
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip() or None


def _fetch_plate(store: _Store, plant: Plant) -> dict[str, object]:
    info = _commons_plate_info(plant.plate.file)
    licence = _meta(info, "LicenseShortName") or ""
    if licence.lower() not in PUBLIC_DOMAIN_LICENCES:
        raise ValueError(f"{plant.id}: plate licence is {licence!r}, not public domain")
    url = str(info.get("thumburl") or info["url"])
    extension = Path(urllib.parse.urlsplit(url).path).suffix.lower() or ".jpg"
    saved = store.save(f"plates/{plant.id}{extension}", url)
    time.sleep(4)
    return {
        "path": saved.path,
        "commonsFile": plant.plate.file,
        "commonsPage": str(info.get("descriptionurl") or ""),
        "originalUrl": str(info["url"]),
        "originalSha1": str(info.get("sha1") or ""),
        "licence": licence,
        "artist": _meta(info, "Artist"),
        "credit": _meta(info, "Credit"),
        "date": _meta(info, "DateTimeOriginal"),
        "book": plant.plate.book,
    }


def _fetch_gf15(store: _Store) -> dict[str, object]:
    articles: dict[str, object] = {}
    for key, path in GF15_ARTICLES.items():
        page_url = GF15_BASE + path
        page = store.save(f"gf15/{key}.html", page_url, _download(page_url), pinned=False)
        page_html = (store.root / page.path).read_text(encoding="utf-8")
        orders = set(_GF_ORDER.findall(page_html))
        if len(orders) != 1:
            raise ValueError(f"ГФ XV {key}: expected one approving order, found {sorted(orders)}")
        ((order_path, order_title),) = orders
        saved = store.save(f"gf15/{key}.order.pdf", GF15_BASE + order_path)
        articles[key] = {
            "page": page_url,
            "path": page.path,
            "order": {
                "title": order_title.strip(),
                "url": GF15_BASE + order_path,
                "path": saved.path,
            },
        }
    return articles


# Pharmacognosy teaching texts whose «примеси» tables name the look-alikes of collected herbs; used
# with the owner's decision of 2026-10-19 (personal project). Pinned: quotes are checked on them.
MANUALS = {
    "nuph-2016": {
        "url": (
            "https://gnosy.nuph.edu.ua/wp-content/uploads/2019/02/"
            "%D0%93%D0%AD%D0%9A_%D0%BA%D0%BE%D0%BD%D1%81%D0%BF%D0%B5%D0%BA%D1%82_45.pdf"
        ),
        "citation": (
            "Конспект лекций для подготовки к экзамену по фармакогнозии. Приложение 4 «Примеси к "
            "лекарственному растительному сырью». — Харьков: НФаУ, 2016"
        ),
        "short": "НФаУ, 2016",
    },
    "ssmu-2013": {
        "url": "https://elar.ssmu.ru/bitstream/20.500.12701/3156/1/tut_ssmu-2013-25.pdf",
        "citation": (
            "Коломиец Н. Э., Калинкина Г. И., Полуэктова Т. В. Учебная практика по фармакогнозии: "
            "учебное пособие. — Томск: СибГМУ, 2013. — 106 с."
        ),
        "short": "СибГМУ, 2013",
    },
}


def _fetch_manuals(store: _Store) -> dict[str, object]:
    manuals: dict[str, object] = {}
    for key, entry in MANUALS.items():
        saved = store.save(f"manuals/{key}.pdf", entry["url"])
        manuals[key] = {**entry, "path": saved.path}
    return manuals


_GF_NUMBER = re.compile(r'<meta name="description" content="(ФС\.[0-9.]+):\s*([^"]+?)\.?"')


def _fetch_gf_article(store: _Store, plant: Plant) -> dict[str, object]:
    """The plant's ГФ raw-material article; its HTML holds the text (definition, appearance)."""
    page_url = GF15_BASE + plant.gf.path
    page = store.save(f"gf/{plant.id}.html", page_url, _download(page_url), pinned=False)
    found = _GF_NUMBER.search((store.root / page.path).read_text(encoding="utf-8"))
    if found is None:
        raise ValueError(f"{plant.id}: the ГФ page has no article number ({page_url})")
    return {
        "page": page_url,
        "path": page.path,
        "edition": plant.gf.edition,
        "number": found.group(1),
        "title": html.unescape(found.group(2)).strip(),
    }


def fetch_herbal_sources(
    plants_path: Path,
    output: Path,
    *,
    refresh: bool = False,
    only: frozenset[str] | None = None,
    gf_only: bool = False,
) -> dict[str, object]:
    plants = load_plants(plants_path)
    output.mkdir(parents=True, exist_ok=True)
    store = _Store(output, refresh)
    manifest_path = output / MANIFEST_NAME
    previous = (
        cast("dict[str, object]", json.loads(manifest_path.read_text(encoding="utf-8")))
        if manifest_path.exists()
        else {}
    )
    ema = cast("dict[str, object]", previous.get("ema") or {})
    plates = cast("dict[str, object]", previous.get("plates") or {})
    gf_articles = cast("dict[str, object]", previous.get("gfArticles") or {})
    for plant in plants:
        if only is not None and plant.id not in only:
            continue
        if not gf_only:
            ema[plant.id] = _fetch_ema(store, plant)
            plates[plant.id] = _fetch_plate(store, plant)
        gf_articles[plant.id] = _fetch_gf_article(store, plant)
        store.write_manifest({**previous, "ema": ema, "plates": plates, "gfArticles": gf_articles})
    gf15 = _fetch_gf15(store)
    manuals = _fetch_manuals(store)
    return store.write_manifest(
        {
            "plantList": str(plants_path),
            "updatedAt": _now(),
            "ema": ema,
            "plates": plates,
            "gf15": gf15,
            "gfArticles": gf_articles,
            "manuals": manuals,
            "notices": {
                "ema": (
                    "© European Medicines Agency. Reproduction is authorised provided the "
                    "source is acknowledged."
                ),
                "gf15": "Государственная фармакопея Российской Федерации, XV и XIV издания.",
            },
        }
    )


def report_json(manifest: dict[str, object]) -> str:
    plates = cast("dict[str, dict[str, object]]", manifest.get("plates") or {})
    ema = cast("dict[str, dict[str, object]]", manifest.get("ema") or {})
    summary = {
        "plants": len(ema),
        "plates": {key: value.get("licence") for key, value in plates.items()},
        "emaDocuments": {
            key: sorted(cast("dict[str, object]", value.get("documents") or {}))
            for key, value in ema.items()
        },
        "files": len(cast("list[object]", manifest.get("files") or [])),
    }
    return json.dumps(summary, ensure_ascii=False, indent=2)
