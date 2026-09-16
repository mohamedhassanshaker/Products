"""Golden-set regression evaluation (B-9) — pure, vendor-free scoring math.

This module holds exactly the one piece of evaluation logic that (a) has no
I/O of its own and (b) is worth sharing between `shj3-ai`'s own
`/v1/evaluation/score-similarity` endpoint and a unit test that proves the
math is real, not a network call away from being tested at all. Everything
else evaluation needs — persisting `RegressionRun`/`RegressionCaseResult`
rows, deciding pass/fail thresholds, rolling up a run's aggregate scores — is
NOT here: see this module's own package docstring gap note below for why.

**Why "run a golden set" is not a `shj3-ai` use case, despite the original
brief for this pass asking for one.** `shj3-ai`'s real SQL Server principal
(`shj3_ai_ro`, `prisma/sql/002_tenant_grants.sql`) has `INSERT`/`UPDATE` on
exactly `ConversationTurns`, `OrchestrationTraces`, `OrchestrationTraceSteps`,
`GroundingCitations` and `ReindexJobs` — confirmed by reading that file
directly, not assumed. It has schema-wide `SELECT` but no write grant at all
on `Conversations`, `GoldenSets`, `GoldenCases`, `RegressionRuns` or
`RegressionCaseResults`; `orchestration_repository.py`'s own module
docstring already says as much ("Write scope is exactly ... ConversationTurns,
OrchestrationTraces, OrchestrationTraceSteps, GroundingCitations"). Only
`shj3_app` (the web tier's own Prisma-backed role) has full DML on the tenant
schema. So the batch orchestration — creating a synthetic `Conversation` per
case, writing the `RegressionRun`/`RegressionCaseResult` rows, updating
`GoldenSets.lastScore`/`lastRunAt` — has to live on the `apps/web` side
against its own Prisma client, not here. Altering the grant itself is out of
scope for this pass (`prisma/sql/002_tenant_grants.sql` is part of the
already-migrated foundation this feature is built against, same posture as
`001_constraints.sql`) — a real, load-bearing finding, flagged here plainly
rather than routed around by widening a deliberately narrow, security-audited
grant. What `shj3-ai` DOES own, and what this module plus
`adapters/inbound/evaluation_router.py` provide, is the two grant-safe pieces
the web-side use case cannot do itself: (1) actually running one pinned-version
turn through the real orchestration pipeline (`/v1/evaluation/turns`, which
only writes to the four tables `shj3_ai_ro` is already granted), and (2)
computing a real embedding-based similarity score (`/v1/evaluation/score-similarity`,
which touches no table at all).
"""

from __future__ import annotations

import math


def cosine_similarity(actual: list[float], expected: list[float]) -> float:
    """Cosine similarity between two equal-length embedding vectors, clamped
    to `[0, 1]`.

    Cosine similarity is mathematically in `[-1, 1]`; a hostile or wildly
    off-topic answer can legitimately score negative against its expected
    text. This evaluation only ever wants a plain "how close is this"
    `[0, 1]` scale — every other regression score column
    (`RegressionRuns.accuracy`/`groundedness`/`toolAccuracy`/`localeParity`)
    is constrained to `[0, 1]` by `CK_RegressionRuns_scoresInRange`, and
    keeping this one on the same scale (rather than preserving a sign that
    is already meaningless in this context) is a deliberate consistency
    choice, not an oversight.

    A zero-magnitude vector (an all-zero embedding — an edge case some
    providers produce for an empty string) has no defined direction, so it
    never contributes a real similarity: returns `0.0` rather than raising
    `ZeroDivisionError` or propagating a `nan`.
    """
    if not actual or len(actual) != len(expected):
        return 0.0
    dot = sum(a * b for a, b in zip(actual, expected, strict=True))
    norm_actual = math.sqrt(sum(a * a for a in actual))
    norm_expected = math.sqrt(sum(b * b for b in expected))
    if norm_actual == 0.0 or norm_expected == 0.0:
        return 0.0
    raw = dot / (norm_actual * norm_expected)
    return max(0.0, min(1.0, raw))
