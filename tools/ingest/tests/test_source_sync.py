from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar

import pytest
import yaml

from localmed_ingest.source_sync import sync_source_manifest


class _SourceHandler(BaseHTTPRequestHandler):
    payload: ClassVar[bytes] = b"# Updated recommendation\n\nSource text.\n"
    etag: ClassVar[str] = '"pilot-v1"'
    request_count: ClassVar[int] = 0
    user_agent: ClassVar[str | None] = None

    def do_GET(self) -> None:
        type(self).request_count += 1
        type(self).user_agent = self.headers.get("User-Agent")
        if self.headers.get("If-None-Match") == self.etag:
            self.send_response(304)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/markdown; charset=utf-8")
        self.send_header("Content-Length", str(len(self.payload)))
        self.send_header("ETag", self.etag)
        self.send_header("Last-Modified", "Sun, 19 Jul 2026 12:00:00 GMT")
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, format: str, *args: object) -> None:
        del format, args


class _ArchiveHandler(BaseHTTPRequestHandler):
    payload: ClassVar[bytes] = b"PK\x03\x04archive-v1"
    filename: ClassVar[str] = "esklp_20260828.zip"
    get_count: ClassVar[int] = 0
    head_count: ClassVar[int] = 0

    def _headers(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(self.payload)))
        self.send_header("Content-Disposition", f"attachment;filename={self.filename}")
        self.end_headers()

    def do_HEAD(self) -> None:
        type(self).head_count += 1
        self._headers()

    def do_GET(self) -> None:
        type(self).get_count += 1
        self._headers()
        self.wfile.write(self.payload)

    def log_message(self, format: str, *args: object) -> None:
        del format, args


def _write_manifest(path: Path, sources: list[dict[str, object]]) -> None:
    path.write_text(
        yaml.safe_dump({"version": 1, "sources": sources}, sort_keys=False),
        encoding="utf-8",
    )


def test_syncs_local_files_through_content_addressed_cache(tmp_path: Path) -> None:
    input_root = tmp_path / "input"
    input_root.mkdir()
    source = input_root / "recommendation.md"
    source.write_text("# Recommendation\n\nStable source text.\n", encoding="utf-8")
    manifest = tmp_path / "sources.yaml"
    _write_manifest(
        manifest,
        [
            {
                "id": "local-recommendation",
                "location": "recommendation.md",
                "target": "documents/recommendation.md",
                "content_type": "markdown",
            }
        ],
    )

    output = tmp_path / "output"
    cache = tmp_path / "cache"
    first = sync_source_manifest(manifest, output, cache, input_root=input_root)
    second = sync_source_manifest(manifest, output, cache, input_root=input_root)

    assert first.materialized == 1
    assert first.sources[0].status == "local"
    assert second.materialized == 0
    assert second.sources[0].status == "unchanged"
    assert second.sources[0].cache_hit is True
    assert (output / "documents/recommendation.md").read_text(encoding="utf-8") == source.read_text(
        encoding="utf-8"
    )


def test_remote_sync_uses_conditional_request_and_stale_cache(tmp_path: Path) -> None:
    _SourceHandler.request_count = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SourceHandler)
    host, port = server.server_address[:2]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    manifest = tmp_path / "sources.yaml"
    _write_manifest(
        manifest,
        [
            {
                "id": "remote-recommendation",
                "location": f"http://{host}:{port}/recommendation.md",
                "target": "recommendation.json",
                "content_type": "text",
            }
        ],
    )
    output = tmp_path / "output"
    cache = tmp_path / "cache"

    try:
        first = sync_source_manifest(manifest, output, cache)
        second = sync_source_manifest(manifest, output, cache)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    fallback = sync_source_manifest(manifest, output, cache)

    assert first.sources[0].status == "downloaded"
    assert first.sources[0].cache_hit is False
    assert second.sources[0].status == "not-modified"
    assert second.sources[0].cache_hit is True
    assert fallback.sources[0].status == "cache-fallback"
    assert fallback.sources[0].warning is not None
    assert (output / "recommendation.json").read_bytes() == _SourceHandler.payload
    assert _SourceHandler.request_count == 2
    assert _SourceHandler.user_agent == "MiniMed/0.5"


def test_remote_binary_archive_uses_header_preflight_before_redownload(tmp_path: Path) -> None:
    _ArchiveHandler.payload = b"PK\x03\x04archive-v1"
    _ArchiveHandler.filename = "esklp_20260828.zip"
    _ArchiveHandler.get_count = 0
    _ArchiveHandler.head_count = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), _ArchiveHandler)
    host, port = server.server_address[:2]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    manifest = tmp_path / "sources.yaml"
    _write_manifest(
        manifest,
        [
            {
                "id": "esklp-archive",
                "location": f"http://{host}:{port}/download/stable-uuid",
                "target": "esklp/latest.zip",
                "content_type": "binary",
            }
        ],
    )
    output = tmp_path / "output"
    cache = tmp_path / "cache"

    try:
        first = sync_source_manifest(manifest, output, cache)
        second = sync_source_manifest(manifest, output, cache)
        _ArchiveHandler.filename = "esklp_20260830.zip"
        _ArchiveHandler.payload = b"PK\x03\x04archive-v2"
        third = sync_source_manifest(manifest, output, cache)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert first.sources[0].status == "downloaded"
    assert second.sources[0].status == "not-modified"
    assert third.sources[0].status == "downloaded"
    assert third.sources[0].content_disposition == "attachment;filename=esklp_20260830.zip"
    assert _ArchiveHandler.get_count == 2
    assert _ArchiveHandler.head_count == 2
    assert (output / "esklp/latest.zip").read_bytes() == _ArchiveHandler.payload


def test_offline_mode_requires_and_reuses_validated_cache(tmp_path: Path) -> None:
    manifest = tmp_path / "sources.yaml"
    _write_manifest(
        manifest,
        [
            {
                "id": "remote-recommendation",
                "location": "https://example.invalid/recommendation.pdf",
                "target": "recommendation.pdf",
                "content_type": "pdf",
            }
        ],
    )

    with pytest.raises(FileNotFoundError, match="No cached payload"):
        sync_source_manifest(manifest, tmp_path / "output", tmp_path / "cache", offline=True)


def test_rejects_target_path_traversal(tmp_path: Path) -> None:
    input_root = tmp_path / "input"
    input_root.mkdir()
    (input_root / "source.md").write_text("# Safe\n", encoding="utf-8")
    manifest = tmp_path / "sources.yaml"
    _write_manifest(
        manifest,
        [
            {
                "id": "escape",
                "location": "source.md",
                "target": "../escaped.md",
                "content_type": "markdown",
            }
        ],
    )

    with pytest.raises(ValueError, match="escapes output root"):
        sync_source_manifest(
            manifest,
            tmp_path / "output",
            tmp_path / "cache",
            input_root=input_root,
        )
