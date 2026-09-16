"""Pure domain types and logic for Graph RAG (B6, brief requirement R6).

Zero vendor imports — no ``neo4j``, ``qdrant_client``, ``openai``, ``cohere``,
``sqlalchemy``, ``fastapi`` (architecture.md §4's swap test, enforced by
``pyproject.toml``'s import-linter "forbidden" contract). Everything here is
plain data and pure functions: chunking, a deterministic gazetteer-based
entity extractor standing in for a future LLM/NER pipeline, and the hybrid
scoring math. Nothing here talks to a store, a model provider or a request.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Literal

EntityLabel = Literal["Service", "Provider", "Fee", "Document", "Channel"]

# ---------------------------------------------------------------------------
# Chunking (FR-KNOW-11: chunk size, chunk overlap, both tenant-configurable)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ChunkSpan:
    """One chunk's boundaries and text, before it has a `chunk_id`.

    `chunk_id` is a SQL Server ULID minted by the caller (`shj3-web`, the only
    writer of `Chunks` — ADR-0005 rule 5 / data-model.md §3.6), so this type
    deliberately carries none. Chunking is pure text-splitting and needs no
    store.
    """

    ordinal: int
    text: str
    token_count: int
    char_start: int
    char_end: int
    content_hash: str


def _approximate_token_count(text: str) -> int:
    """A word-count-based approximation, not a real tokenizer.

    Real tokenization (tiktoken/BPE) would tie the chunk boundary to whatever
    encoding `SHJ3_OPENAI_EMBEDDING_MODEL` happens to use today. A word-based
    approximation (~0.75 tokens/word for English, rounded up) is deliberately
    conservative — it is close enough for a 512-token target chunk size to
    produce chunks of a sane, reviewable size, without coupling the chunker to
    one vendor's tokenizer. Revisit if chunk-size precision becomes a real
    product complaint; it has not been one yet.
    """
    words = text.split()
    return max(1, int(len(words) * 0.75) + 1)


def chunk_document(
    text: str,
    chunk_size_tokens: int,
    chunk_overlap_tokens: int,
) -> list[ChunkSpan]:
    """Split `text` into overlapping chunks, word-boundary aligned.

    `chunk_overlap_tokens` must be strictly less than `chunk_size_tokens`
    (mirrors `CK_RetrievalConfigs_overlapLessThanSize`) or the window never
    advances — guarded here defensively so a caller cannot hang this on a
    misconfigured tenant.
    """
    if chunk_size_tokens <= 0:
        raise ValueError("chunk_size_tokens must be positive")
    if chunk_overlap_tokens < 0 or chunk_overlap_tokens >= chunk_size_tokens:
        raise ValueError(
            "chunk_overlap_tokens must be non-negative and less than chunk_size_tokens"
        )

    words = text.split()
    if not words:
        return []

    # Words-per-chunk derived from the same 0.75 tokens/word approximation
    # `_approximate_token_count` uses, so a chunk's reported token_count is
    # consistent with the boundary that produced it.
    words_per_chunk = max(1, int(chunk_size_tokens / 0.75))
    words_overlap = max(0, int(chunk_overlap_tokens / 0.75))
    stride = max(1, words_per_chunk - words_overlap)

    spans: list[ChunkSpan] = []
    # char offsets are computed against the original text by re-locating each
    # chunk's first/last word — cheap because chunks are processed in order
    # and the search only ever moves forward.
    cursor = 0
    ordinal = 0
    start_word = 0
    while start_word < len(words):
        end_word = min(start_word + words_per_chunk, len(words))
        chunk_words = words[start_word:end_word]
        chunk_text = " ".join(chunk_words)

        char_start = text.index(chunk_words[0], cursor)
        last_word = chunk_words[-1]
        char_end = text.index(last_word, char_start) + len(last_word)
        cursor = char_start

        spans.append(
            ChunkSpan(
                ordinal=ordinal,
                text=chunk_text,
                token_count=_approximate_token_count(chunk_text),
                char_start=char_start,
                char_end=char_end,
                content_hash=hashlib.sha256(chunk_text.encode("utf-8")).hexdigest(),
            )
        )
        ordinal += 1
        if end_word >= len(words):
            break
        start_word += stride

    return spans


# ---------------------------------------------------------------------------
# Entity extraction — a deterministic gazetteer matcher.
#
# **Deliberately simplified, and flagged as such.** A real system would run an
# LLM or a trained NER model over each chunk to propose entities and
# relationships. That is a substantial, separate undertaking (model choice,
# prompt/schema design, evaluation against the golden set) and is out of
# scope for this pass. What is built here is honest and real for what it is:
# a closed, reviewable, deterministic gazetteer lookup that reliably produces
# real graph writes for the seeded government entities this system already
# knows about (SEWA, Sharjah Customs, Sharjah Libraries, ...), which is
# sufficient to prove the ingestion → graph pipeline end-to-end. Swapping this
# for an LLM-based extractor later touches only this module, not `application/`
# or the graph adapter — extraction is a port-shaped seam
# (`application/embed_and_index.py` takes `extract_entities` as an injectable
# function precisely so this is easy to replace without touching orchestration).
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ExtractedEntity:
    label: EntityLabel
    canonical_key: str
    canonical_name: str
    char_start: int
    char_end: int


@dataclass(frozen=True, slots=True)
class ExtractedEdge:
    relationship_type: str
    from_key: str
    to_key: str
    confidence: float


@dataclass(frozen=True, slots=True)
class GazetteerEntry:
    label: EntityLabel
    canonical_key: str
    canonical_name: str
    #: Case-insensitive surface forms that trigger a match, including the
    #: canonical name itself.
    aliases: tuple[str, ...] = field(default_factory=tuple)


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "entity"


#: The built-in default gazetteer — the seeded government entities named
#: throughout requirements.md/the wireframe (SEWA, Sharjah Customs, Sharjah
#: Libraries, du/Etisalat as providers on the Channel/Fee side of the seeded
#: duplicate-detection scenarios). Deliberately small and closed; a real
#: deployment would grow this from `GraphNodeRecords` already on file
#: (`known_entities` below accepts additional entries for exactly that).
DEFAULT_GAZETTEER: tuple[GazetteerEntry, ...] = (
    GazetteerEntry(
        "Provider",
        "sewa",
        "SEWA",
        (
            "sewa",
            "sharjah electricity and water authority",
            "sharjah electricity & water authority",
        ),
    ),
    GazetteerEntry("Provider", "sharjah-customs", "Sharjah Customs", ("sharjah customs",)),
    GazetteerEntry(
        "Provider",
        "sharjah-libraries",
        "Sharjah Libraries",
        ("sharjah libraries", "sharjah public libraries"),
    ),
    GazetteerEntry("Provider", "du", "du", ("du telecom", " du ")),
    GazetteerEntry("Provider", "etisalat", "Etisalat", ("etisalat",)),
    GazetteerEntry(
        "Service",
        "pay-utilities-bill",
        "Pay utilities bill",
        ("pay utilities bill", "utilities bill", "electricity and water bill"),
    ),
    GazetteerEntry(
        "Service",
        "customs-duty-payment",
        "Customs duty payment",
        ("customs duty", "customs duty payment"),
    ),
    GazetteerEntry(
        "Service",
        "library-membership",
        "Library membership",
        ("library membership", "library card"),
    ),
    GazetteerEntry(
        "Fee", "standard-tariff", "Standard tariff", ("standard tariff", "tariff schedule")
    ),
    GazetteerEntry("Fee", "membership-fee", "Membership fee", ("membership fee", "annual fee")),
    GazetteerEntry("Channel", "web-widget", "Web widget", ("web widget", "website")),
    GazetteerEntry("Channel", "whatsapp", "WhatsApp", ("whatsapp",)),
)


def extract_entities(
    text: str,
    known_entities: tuple[GazetteerEntry, ...] = (),
) -> list[ExtractedEntity]:
    """Find every gazetteer surface form present in `text`.

    `known_entities` is appended to :data:`DEFAULT_GAZETTEER` rather than
    replacing it, so a caller can extend recognition (e.g. from a tenant's
    existing `GraphNodeRecords`) without losing the built-in seed set.
    """
    lowered = text.lower()
    found: list[ExtractedEntity] = []
    seen_keys: set[str] = set()
    for entry in (*DEFAULT_GAZETTEER, *known_entities):
        if entry.canonical_key in seen_keys:
            continue
        for alias in (entry.canonical_name, *entry.aliases):
            idx = lowered.find(alias.lower())
            if idx >= 0:
                found.append(
                    ExtractedEntity(
                        label=entry.label,
                        canonical_key=entry.canonical_key,
                        canonical_name=entry.canonical_name,
                        char_start=idx,
                        char_end=idx + len(alias),
                    )
                )
                seen_keys.add(entry.canonical_key)
                break
    return found


#: The only entity-pair shapes a `Service`-anchored edge may take, mirroring
#: `TR_GraphEdgeRecords_typeMatchesLabels` (prisma/sql/001_constraints.sql)
#: exactly — kept here, not re-derived, so the two never quietly disagree.
_SERVICE_EDGE_FOR: dict[EntityLabel, str] = {
    "Provider": "PROVIDED_BY",
    "Fee": "HAS_FEE",
    "Document": "DOCUMENTED_BY",
    "Channel": "AVAILABLE_ON",
}


def infer_edges(entities: list[ExtractedEntity]) -> list[ExtractedEdge]:
    """Propose edges between co-occurring entities in one chunk.

    Deliberately narrow: only edges anchored on a `Service` node are proposed
    (the pattern table's `Service→*` rows), since inferring `Fee→Channel`
    from bare co-occurrence would be a much weaker signal. `confidence` is
    fixed at 0.6 for a same-chunk co-occurrence — real weighting by proximity
    or syntax is a refinement for whoever replaces this extractor.
    """
    services = [e for e in entities if e.label == "Service"]
    others = [e for e in entities if e.label != "Service"]
    edges: list[ExtractedEdge] = []
    for service in services:
        for other in others:
            rel = _SERVICE_EDGE_FOR.get(other.label)
            if rel is None:
                continue
            edges.append(
                ExtractedEdge(
                    relationship_type=rel,
                    from_key=service.canonical_key,
                    to_key=other.canonical_key,
                    confidence=0.6,
                )
            )
    return edges


# ---------------------------------------------------------------------------
# Hybrid scoring (data-model.md §6.5) and grounding confidence.
# ---------------------------------------------------------------------------


def normalise(value: float, max_value: float) -> float:
    """Scale a raw score into [0, 1] against the batch's own maximum.

    Returns 0.0 for a non-positive `max_value` rather than dividing by zero —
    an empty or all-zero candidate set normalises to "no signal", not a crash.
    """
    if max_value <= 0:
        return 0.0
    return max(0.0, min(1.0, value / max_value))


def hybrid_score(
    graph_score: float,
    vector_score: float,
    graph_weight: float,
    vector_weight: float,
    grounding_penalty: float = 0.0,
) -> float:
    """`hybridScore = graphWeight·graph + vectorWeight·vector - penalty` (§6.5).

    Both scores are expected already normalised to [0, 1] by the caller
    (:func:`normalise`, applied across the whole candidate batch) — this
    function only does the weighted blend and penalty subtraction, and clamps
    the floor at 0 so an open conflict cannot push a score negative.
    """
    return max(0.0, graph_weight * graph_score + vector_weight * vector_score - grounding_penalty)


def grounding_confidence(
    top_hybrid_score: float,
    open_conflict_penalty: float,
    degraded: bool,
) -> float:
    """A single [0, 1] confidence figure gating refusal (B12, NFR/RISK-005 reading).

    Degradation (graph down, rerank down) lowers confidence on top of the
    conflict penalty already folded into `top_hybrid_score` — "a lower score
    is more likely to sit under the policy chain's refusal floor... rather
    than serving an answer that reads as well-grounded but traversed
    nothing" (data-model.md §6.5). The degradation haircut is a flat 15%,
    deliberately larger than a typical open-conflict penalty (§4.7's
    `groundingPenalty` is `BETWEEN 0 AND 1`, tenant-tunable, but conflicts in
    this system default well under 15%) so a degraded answer is reliably
    less confident than a merely-conflicted one, never the reverse.
    """
    confidence = max(0.0, top_hybrid_score - open_conflict_penalty)
    if degraded:
        confidence *= 0.85
    return max(0.0, min(1.0, confidence))
