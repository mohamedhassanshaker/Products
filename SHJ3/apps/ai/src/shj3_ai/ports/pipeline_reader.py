"""The `PipelineReader` port — resolves a real, persisted pipeline graph into a
`domain.pipeline.PipelineDefinition`.

Deliberately NOT folded into `ConfigReader`: that port's own shape (one combined
Protocol, matching `KnowledgeSqlReader`'s precedent) fits a fixed, small set of flat,
tenant-scoped singleton/lookup reads. A pipeline read is a three-table aggregate
(`PipelineVersions` + `PipelineNodes` + `PipelineEdges`) projected into one nested domain
object — the same shape `FlowReader` already exists for, not `ConfigReader`'s.
"""

from __future__ import annotations

from typing import Protocol

from shj3_ai.domain.pipeline import PipelineDefinition


class PipelineReader(Protocol):
    async def get_active_pipeline_version(self) -> PipelineDefinition | None:
        """Resolves `RouterConfigs.activePipelineVersionId` -> the full, already-Published
        `PipelineDefinition` in one `tenant_session()`. `None` when the tenant has never
        activated one — never raises, mirroring `ConfigReader.get_router_config()`'s own
        never-raise contract."""

    async def get_pipeline_version_by_id(
        self, pipeline_version_id: str
    ) -> PipelineDefinition | None:
        """A SPECIFIC version, Draft included — the authoring/preview read. Mirrors the
        exact distinction `ConfigReader.get_agent_version_by_id` vs.
        `get_current_agent_version` already draws, for the same reason: a preview must be
        able to run an unpublished pipeline before it is published."""
