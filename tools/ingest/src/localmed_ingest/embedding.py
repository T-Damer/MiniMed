from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Iterable

from .models import ChunkEmbedding, EmbeddingProfile

WORD_WEIGHT = 4
BIGRAM_WEIGHT = 3
TRIGRAM_WEIGHT = 1
MAX_QUANTIZED_VALUE = 127
PORTABLE_HASH_PROFILE = EmbeddingProfile(
    id="localmed.feature-hash.384.v1",
    dimensions=384,
    vector_format="int8",
    normalization="l2",
    generator="feature-hash",
    generator_version="1",
    fingerprint="feature-hash-v1:384:int8:l2",
    metadata={
        "intendedUse": "development-retrieval-scaffold",
        "neuralModel": False,
    },
)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower().replace("ё", "е")
    return re.sub(r"\s+", " ", re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)).strip()


def tokenize(value: str) -> list[str]:
    return [token for token in normalize_text(value).split(" ") if len(token) >= 2]


def fnv1a32(value: str) -> int:
    result = 0x811C9DC5
    for byte in value.encode("utf-8"):
        result ^= byte
        result = (result * 0x01000193) & 0xFFFFFFFF
    return result


def add_feature(accumulator: list[int], feature: str, weight: int) -> None:
    hashed = fnv1a32(feature)
    index = (hashed & 0x7FFFFFFF) % len(accumulator)
    sign = 1 if hashed & 0x80000000 == 0 else -1
    accumulator[index] += sign * weight


def add_token_features(accumulator: list[int], source_tokens: list[str]) -> None:
    for index, token in enumerate(source_tokens):
        add_feature(accumulator, f"w:{token}", WORD_WEIGHT)
        if index + 1 < len(source_tokens):
            add_feature(accumulator, f"b:{token}\0{source_tokens[index + 1]}", BIGRAM_WEIGHT)
        code_points = list(token)
        if len(code_points) < 3:
            add_feature(accumulator, f"c:{token}", TRIGRAM_WEIGHT)
            continue
        for offset in range(len(code_points) - 2):
            add_feature(
                accumulator, f"c:{''.join(code_points[offset : offset + 3])}", TRIGRAM_WEIGHT
            )


def quantize(accumulator: list[int]) -> list[int]:
    squared_norm = sum(value * value for value in accumulator)
    if squared_norm == 0:
        return [0] * len(accumulator)
    norm = math.sqrt(squared_norm)
    result: list[int] = []
    for value in accumulator:
        scaled = value / norm * MAX_QUANTIZED_VALUE
        rounded = int(math.copysign(math.floor(abs(scaled) + 0.5), scaled)) if scaled else 0
        result.append(max(-MAX_QUANTIZED_VALUE, min(MAX_QUANTIZED_VALUE, rounded)))
    return result


def vector_norm(values: Iterable[int]) -> float:
    return math.sqrt(sum(value * value for value in values))


def embed_text(
    text: str, profile: EmbeddingProfile = PORTABLE_HASH_PROFILE
) -> tuple[list[int], float]:
    if profile.vector_format != "int8" or profile.normalization != "l2":
        raise ValueError(f"Unsupported embedding profile: {profile.id}")
    accumulator = [0] * profile.dimensions
    add_token_features(accumulator, tokenize(text))
    values = quantize(accumulator)
    return values, vector_norm(values)


def build_chunk_embedding(
    chunk_id: str,
    text: str,
    profile: EmbeddingProfile = PORTABLE_HASH_PROFILE,
) -> ChunkEmbedding:
    values, norm = embed_text(text, profile)
    return ChunkEmbedding(profile_id=profile.id, chunk_id=chunk_id, values=values, norm=norm)
