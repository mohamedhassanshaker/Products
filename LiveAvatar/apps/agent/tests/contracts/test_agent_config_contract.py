"""The CI cross-language contract test (ADR-001 §1/§7, LLD §6.3).

Runs the shared fixture corpus (`apps/agent/fixtures/agent-config/{valid,invalid}`)
through the Pydantic `AgentConfig` mirror. The **same** corpus is run through
the TypeBox `AgentConfigSchema` by
`packages/contracts/src/agent-config/schema.contract.spec.ts` on the
TypeScript side. Divergence between the two validators on any fixture is
exactly the drift ADR-001 names as "the single most important test in the
repo" — this file (plus its TS sibling) is that test.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from avatar_agent.contracts.runtime_config import AgentConfig

FIXTURES_DIR = Path(__file__).parents[2] / "fixtures" / "agent-config"


def _fixture_files(subdir: str) -> list[Path]:
    directory = FIXTURES_DIR / subdir
    return sorted(directory.glob("*.yaml"))


@pytest.mark.parametrize("path", _fixture_files("valid"), ids=lambda p: p.stem)
def test_valid_fixtures_are_accepted(path: Path) -> None:
    """Every fixture under `valid/` must parse into `AgentConfig` cleanly."""
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    AgentConfig.model_validate(raw)  # raises ValidationError on disagreement


@pytest.mark.parametrize("path", _fixture_files("invalid"), ids=lambda p: p.stem)
def test_invalid_fixtures_are_rejected(path: Path) -> None:
    """Every fixture under `invalid/` must be rejected by `AgentConfig`."""
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    with pytest.raises(ValidationError):
        AgentConfig.model_validate(raw)


def test_fixture_corpus_is_non_empty() -> None:
    """Guards against a silently-empty corpus making the two tests above
    vacuously pass (parametrize with zero cases still reports green).
    """
    assert len(_fixture_files("valid")) >= 3
    assert len(_fixture_files("invalid")) >= 5
