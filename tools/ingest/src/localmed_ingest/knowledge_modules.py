from __future__ import annotations

import json
from pathlib import Path

import yaml

from .knowledge import KnowledgeWorkspace, validate_knowledge_workspace
from .models import PackDocument

_COLLECTION_KEYS = ("entities", "facts", "relations", "documentLinks", "reviewTasks")


def _read_module(path: Path) -> dict[str, object]:
    if path.suffix == ".json":
        payload: object = json.loads(path.read_text(encoding="utf-8"))
    else:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected knowledge module mapping: {path}")
    return {str(key): value for key, value in payload.items()}


def load_knowledge_modules(input_dir: Path, documents: list[PackDocument]) -> KnowledgeWorkspace:
    """Compose every knowledge YAML/JSON file into one validated relational workspace.

    YAML remains convenient for human editorial work. JSON is preferred for imported registry
    snapshots because exact evidence quotes do not require YAML-specific escaping.
    """

    paths = sorted([*input_dir.glob("knowledge*.json"), *input_dir.glob("knowledge*.yaml")])
    if not paths:
        return KnowledgeWorkspace()

    schema_version: int | None = None
    collections: dict[str, list[object]] = {key: [] for key in _COLLECTION_KEYS}
    origins: dict[str, Path] = {}

    for path in paths:
        payload = _read_module(path)
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
                collections[key].append(value)

    combined: dict[str, object] = {**collections, "schemaVersion": schema_version or 1}
    workspace = KnowledgeWorkspace.model_validate(combined)
    validate_knowledge_workspace(workspace, documents)
    return workspace
