from __future__ import annotations

from pathlib import Path

from .knowledge import (
    KnowledgeWorkspace,
    _read_yaml_mapping,
    validate_knowledge_workspace,
)
from .models import PackDocument

_COLLECTION_KEYS = ("entities", "facts", "relations", "documentLinks", "reviewTasks")


def load_knowledge_modules(input_dir: Path, documents: list[PackDocument]) -> KnowledgeWorkspace:
    """Load and validate every knowledge*.yaml module as one relational workspace.

    Keeping registry snapshots, guideline relations, and editorial material in separate files avoids
    rewriting a monolithic reviewed workspace while preserving global duplicate-ID and reference
    validation after composition.
    """

    paths = sorted(input_dir.glob("knowledge*.yaml"))
    if not paths:
        return KnowledgeWorkspace()

    schema_version: int | None = None
    combined: dict[str, object] = {key: [] for key in _COLLECTION_KEYS}
    origins: dict[str, Path] = {}

    for path in paths:
        payload = _read_yaml_mapping(path)
        current_schema = payload.get("schemaVersion", payload.get("schema_version", 1))
        if not isinstance(current_schema, int) or current_schema < 1:
            raise ValueError(f"{path}: schemaVersion must be a positive integer.")
        if schema_version is None:
            schema_version = current_schema
        elif current_schema != schema_version:
            raise ValueError(
                f"Knowledge module schema mismatch: {path} uses {current_schema}, "
                f"expected {schema_version}."
            )

        for key in _COLLECTION_KEYS:
            values = payload.get(key, [])
            if not isinstance(values, list):
                raise ValueError(f"{path}: {key} must be a list.")
            target = combined[key]
            assert isinstance(target, list)
            for value in values:
                if not isinstance(value, dict):
                    raise ValueError(f"{path}: every {key} item must be a mapping.")
                identifier = value.get("id")
                if isinstance(identifier, str):
                    previous = origins.get(identifier)
                    if previous is not None:
                        raise ValueError(
                            f"Duplicate knowledge id {identifier} in {previous} and {path}."
                        )
                    origins[identifier] = path
                target.append(value)

    combined["schemaVersion"] = schema_version or 1
    workspace = KnowledgeWorkspace.model_validate(combined)
    validate_knowledge_workspace(workspace, documents)
    return workspace
