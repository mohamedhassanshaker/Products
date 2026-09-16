"""Unit tests for `domain/knowledge.py` — pure chunking, extraction and scoring logic.

No store, no vendor import, no async — this is the part of Graph RAG that
needs neither a container nor a fake to verify.
"""

from __future__ import annotations

from shj3_ai.domain.knowledge import (
    chunk_document,
    extract_entities,
    grounding_confidence,
    hybrid_score,
    infer_edges,
    normalise,
)


class TestChunkDocument:
    def test_empty_text_produces_no_chunks(self) -> None:
        assert chunk_document("", 512, 64) == []

    def test_short_text_is_one_chunk(self) -> None:
        spans = chunk_document("hello world", 512, 64)
        assert len(spans) == 1
        assert spans[0].ordinal == 0
        assert spans[0].text == "hello world"

    def test_long_text_is_split_into_overlapping_chunks(self) -> None:
        text = " ".join(f"word{i}" for i in range(2000))
        spans = chunk_document(text, 100, 20)
        assert len(spans) > 1
        # Ordinals are sequential from zero.
        assert [s.ordinal for s in spans] == list(range(len(spans)))
        # Every chunk's char span is a real, in-bounds slice of the source text.
        for span in spans:
            assert text[span.char_start : span.char_end] != ""
            assert span.char_end > span.char_start

    def test_overlap_must_be_smaller_than_chunk_size(self) -> None:
        import pytest

        with pytest.raises(ValueError, match="overlap"):
            chunk_document("some text", 100, 100)
        with pytest.raises(ValueError, match="overlap"):
            chunk_document("some text", 100, 150)

    def test_content_hash_is_deterministic_and_distinguishes_chunks(self) -> None:
        text = " ".join(f"word{i}" for i in range(500))
        a = chunk_document(text, 50, 5)
        b = chunk_document(text, 50, 5)
        assert [s.content_hash for s in a] == [s.content_hash for s in b]
        hashes = {s.content_hash for s in a}
        assert len(hashes) == len(a), "distinct chunk text must hash distinctly"


class TestExtractEntities:
    def test_finds_a_known_provider_by_alias(self) -> None:
        found = extract_entities("Please contact SEWA about your bill.")
        keys = {e.canonical_key for e in found}
        assert "sewa" in keys

    def test_finds_multiple_entities_in_one_chunk(self) -> None:
        found = extract_entities("To pay your SEWA utilities bill, use the web widget or WhatsApp.")
        keys = {e.canonical_key for e in found}
        assert {"sewa", "pay-utilities-bill", "web-widget", "whatsapp"} <= keys

    def test_case_insensitive_matching(self) -> None:
        found = extract_entities("sewa SEWA SeWa")
        assert len([e for e in found if e.canonical_key == "sewa"]) == 1, (
            "one entity, not one per casing"
        )

    def test_no_match_returns_empty(self) -> None:
        assert extract_entities("completely unrelated text about gardening") == []

    def test_known_entities_extends_rather_than_replaces_the_default_gazetteer(self) -> None:
        from shj3_ai.domain.knowledge import GazetteerEntry

        extra = (GazetteerEntry("Provider", "acme", "Acme Corp", ("acme corp",)),)
        found = extract_entities("Acme Corp and SEWA both appear here.", extra)
        keys = {e.canonical_key for e in found}
        assert "acme" in keys
        assert "sewa" in keys, "the built-in gazetteer must still be searched"


class TestInferEdges:
    def test_infers_service_to_provider_edge(self) -> None:
        entities = extract_entities("Pay utilities bill through SEWA.")
        edges = infer_edges(entities)
        assert any(
            e.relationship_type == "PROVIDED_BY"
            and e.from_key == "pay-utilities-bill"
            and e.to_key == "sewa"
            for e in edges
        )

    def test_no_service_means_no_edges(self) -> None:
        entities = extract_entities("SEWA and du are both providers.")
        assert infer_edges(entities) == []


class TestNormalise:
    def test_scales_into_zero_one(self) -> None:
        assert normalise(5.0, 10.0) == 0.5
        assert normalise(10.0, 10.0) == 1.0
        assert normalise(0.0, 10.0) == 0.0

    def test_zero_max_never_divides_by_zero(self) -> None:
        assert normalise(5.0, 0.0) == 0.0

    def test_clamped_to_the_unit_interval(self) -> None:
        assert normalise(-5.0, 10.0) == 0.0
        assert normalise(50.0, 10.0) == 1.0


class TestHybridScore:
    def test_weighted_blend(self) -> None:
        assert (
            hybrid_score(graph_score=1.0, vector_score=0.0, graph_weight=0.6, vector_weight=0.4)
            == 0.6
        )
        assert (
            hybrid_score(graph_score=0.0, vector_score=1.0, graph_weight=0.6, vector_weight=0.4)
            == 0.4
        )

    def test_penalty_never_pushes_below_zero(self) -> None:
        assert hybrid_score(0.1, 0.1, 0.6, 0.4, grounding_penalty=1.0) == 0.0


class TestGroundingConfidence:
    def test_degradation_lowers_confidence(self) -> None:
        normal = grounding_confidence(0.8, 0.0, degraded=False)
        degraded = grounding_confidence(0.8, 0.0, degraded=True)
        assert degraded < normal

    def test_conflict_penalty_lowers_confidence(self) -> None:
        clean = grounding_confidence(0.8, 0.0, degraded=False)
        conflicted = grounding_confidence(0.8, 0.3, degraded=False)
        assert conflicted < clean

    def test_never_negative(self) -> None:
        assert grounding_confidence(0.1, 0.9, degraded=True) == 0.0
