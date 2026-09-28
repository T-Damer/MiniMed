from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class PublicationDecision:
    """An explicit owner decision to distribute a snapshot despite unresolved source rights.

    It never changes the source's own classification: rights metadata stays as recorded and a
    crawler's own publication gate is kept beside the new state.
    """

    decided_at: str
    decided_by: str
    basis: str
    state: str = "experimental-preview"

    def __post_init__(self) -> None:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", self.decided_at):
            raise ValueError("Publication decision date must be YYYY-MM-DD.")
        if not self.decided_by.strip() or not self.basis.strip():
            raise ValueError("Publication decision needs its author and basis.")
        if self.state != "experimental-preview":
            raise ValueError("Only an experimental-preview publication decision is supported.")

    def metadata(self) -> dict[str, str]:
        return {"decidedAt": self.decided_at, "decidedBy": self.decided_by, "basis": self.basis}
