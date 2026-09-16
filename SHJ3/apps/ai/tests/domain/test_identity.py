"""B-8's assurance ladder and the enum reconciliation B-5 flagged — pure domain,
no fake, no I/O. Mirrors `apps/web`'s `iam/domain/assurance.test.ts` and
`identity/domain/assurance-mapping.test.ts` coverage on the Python side of the
identical bijection."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from shj3_ai.domain.identity import (
    AssuranceLevel,
    CitizenAssurance,
    assurance_rank,
    effective_assurance,
    required_level_to_assurance,
    satisfies_assurance,
    satisfies_required_assurance,
)


class TestAssuranceRank:
    def test_the_ladder_is_monotonic(self) -> None:
        assert assurance_rank(AssuranceLevel.L0) < assurance_rank(AssuranceLevel.L1)
        assert assurance_rank(AssuranceLevel.L1) < assurance_rank(AssuranceLevel.L2)
        assert assurance_rank(AssuranceLevel.L2) < assurance_rank(AssuranceLevel.L3)

    def test_satisfies_is_a_rank_comparison_not_equality(self) -> None:
        # A citizen who reached L2 satisfies an L1 requirement — the classic
        # bug this comparison exists to prevent is an `==` check that would
        # refuse a stronger-than-required session.
        assert satisfies_assurance(AssuranceLevel.L2, AssuranceLevel.L1)
        assert satisfies_assurance(AssuranceLevel.L2, AssuranceLevel.L2)
        assert not satisfies_assurance(AssuranceLevel.L1, AssuranceLevel.L2)


class TestRequiredLevelReconciliation:
    """The exact bijection B-5's own review flagged as missing: `FlowNodes.
    requiredAssurance`/`ToolBindings.requiredAssurance`'s persisted enum
    (`Anonymous`|`Verified`|`VerifiedPlusOtp`|`VerifiedPlusDocument`) mapped
    onto `Principal.assurance`'s `L0`-`L3` rank — matching `docs/requirements.
    md`'s RISK-006 decision and the already-shipped `iam/domain/assurance.ts`,
    not `docs/data-model.md` §4.11's earlier, superseded "L2/L2 shared rank"
    proposal (see `identity/domain/assurance-mapping.ts`'s own doc comment for
    the full reasoning)."""

    @pytest.mark.parametrize(
        ("required", "expected"),
        [
            ("Anonymous", AssuranceLevel.L0),
            ("Verified", AssuranceLevel.L1),
            ("VerifiedPlusOtp", AssuranceLevel.L2),
            ("VerifiedPlusDocument", AssuranceLevel.L3),
        ],
    )
    def test_every_persisted_value_maps_to_its_own_distinct_rank(
        self, required: str, expected: AssuranceLevel
    ) -> None:
        assert required_level_to_assurance(required) == expected

    def test_an_unrecognised_value_raises_rather_than_guessing(self) -> None:
        # `"L0"` specifically — the exact string B-5's own test fixture used
        # by mistake, thinking it was the same ladder as `Principal.assurance`.
        with pytest.raises(KeyError):
            required_level_to_assurance("L0")

    def test_none_means_no_override_configured_and_gates_nothing(self) -> None:
        assert satisfies_required_assurance(AssuranceLevel.L0, None) is True

    @pytest.mark.parametrize(
        ("held", "required", "expected"),
        [
            (AssuranceLevel.L0, "Anonymous", True),
            (AssuranceLevel.L0, "Verified", False),
            (AssuranceLevel.L1, "Verified", True),
            (AssuranceLevel.L1, "VerifiedPlusOtp", False),
            (AssuranceLevel.L2, "VerifiedPlusOtp", True),
            (AssuranceLevel.L2, "VerifiedPlusDocument", False),
            (AssuranceLevel.L3, "VerifiedPlusDocument", True),
        ],
    )
    def test_the_gate_compares_ranks_across_the_reconciled_vocabularies(
        self, held: AssuranceLevel, required: str, expected: bool
    ) -> None:
        assert satisfies_required_assurance(held, required) is expected


class TestEffectiveAssurance:
    def test_no_linked_identity_is_l0(self) -> None:
        assert effective_assurance(None, datetime.now(UTC)) == AssuranceLevel.L0

    def test_a_live_verification_resolves_to_its_mapped_rank(self) -> None:
        now = datetime.now(UTC)
        record = CitizenAssurance(
            level="VerifiedPlusOtp", verification_expires_at=now + timedelta(hours=1)
        )
        assert effective_assurance(record, now) == AssuranceLevel.L2

    def test_assurance_decays_to_l0_once_expired(self) -> None:
        # api.md §9.9: "a payment two hours later re-challenges."
        now = datetime.now(UTC)
        record = CitizenAssurance(
            level="VerifiedPlusOtp", verification_expires_at=now - timedelta(seconds=1)
        )
        assert effective_assurance(record, now) == AssuranceLevel.L0

    def test_a_never_expiring_verification_is_read_at_its_mapped_rank(self) -> None:
        record = CitizenAssurance(level="Verified", verification_expires_at=None)
        assert effective_assurance(record, datetime.now(UTC)) == AssuranceLevel.L1
