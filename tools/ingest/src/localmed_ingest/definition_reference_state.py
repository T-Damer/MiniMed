"""Reader-facing publication states of a definition reference edition."""

from __future__ import annotations

# Neither value means clinically reviewed: `local-dev` is a developer's own build and
# `experimental-preview` a published draft offered only behind the app's experimental mode.
# The content pack itself stays `local-dev`, because `published` there implies a reviewed,
# release-eligible edition.
REFERENCE_PUBLICATION_STATES = ("local-dev", "experimental-preview")
