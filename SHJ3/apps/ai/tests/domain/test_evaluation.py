"""`domain.evaluation.cosine_similarity` — pure math, no fakes needed."""

from __future__ import annotations

import math

from shj3_ai.domain.evaluation import cosine_similarity


class TestCosineSimilarity:
    def test_identical_vectors_score_one(self) -> None:
        vector = [0.4, -0.2, 0.9, 0.1]
        assert math.isclose(cosine_similarity(vector, vector), 1.0, rel_tol=1e-9)

    def test_orthogonal_vectors_score_zero(self) -> None:
        assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0

    def test_opposite_vectors_clamp_to_zero_not_negative_one(self) -> None:
        # Mathematically -1.0 — clamped to the schema's [0, 1] scale rather
        # than surfacing a negative score no other regression column allows.
        assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == 0.0

    def test_a_partial_match_lands_strictly_between_zero_and_one(self) -> None:
        similarity = cosine_similarity([1.0, 1.0, 0.0], [1.0, 0.0, 0.0])
        assert 0.0 < similarity < 1.0

    def test_a_zero_vector_scores_zero_rather_than_dividing_by_zero(self) -> None:
        assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0
        assert cosine_similarity([0.0, 0.0], [0.0, 0.0]) == 0.0

    def test_mismatched_lengths_score_zero_rather_than_raising(self) -> None:
        assert cosine_similarity([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0

    def test_empty_vectors_score_zero(self) -> None:
        assert cosine_similarity([], []) == 0.0
