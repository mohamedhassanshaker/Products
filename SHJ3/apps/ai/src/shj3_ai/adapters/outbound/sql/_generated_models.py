"""
SQLAlchemy models for SHJ3 — GENERATED FILE, DO NOT EDIT.

Generated from prisma/platform/schema.prisma and prisma/tenant/schema.prisma by
scripts/generate-python-models.mjs (ADR-0011 split the Prisma schema in two; this
generator reads both and merges them into one Python model set).

Prisma owns the SQL Server schema and all migrations (ADR-0005). Editing this
file by hand will be reverted by the next generation, and the pre-commit drift
check will fail the commit. To change the schema, edit prisma/platform/schema.prisma
or prisma/tenant/schema.prisma.

Write access: shj3-ai holds SELECT on everything and INSERT/UPDATE on exactly
three table groups — conversation turns, orchestration traces and re-index job
status. That restriction is a database grant, not a property of these classes
(ADR-0005 rule 5), so a mistake here fails at the database rather than silently
corrupting configuration.

Tenant schemas: models declared against `tenant_template` describe the shape of
every tenant's schema. At runtime the session is bound to one tenant's schema
(ADR-0002), so an unqualified query reads that tenant and no other.
"""

# ruff: noqa: E501
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    Integer,
    LargeBinary,
    Numeric,
    String,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base for every generated model."""


class Agent(Base):
    """tenant_template.Agents"""

    __tablename__ = "Agents"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    slug: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    owner_tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ownerTenantId")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    current_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="currentVersionId")
    cloned_from_agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="clonedFromAgentId")
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="archivedAt")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentChannelBinding(Base):
    """tenant_template.AgentChannelBindings"""

    __tablename__ = "AgentChannelBindings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    channel_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelKey")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentFlowBinding(Base):
    """tenant_template.AgentFlowBindings"""

    __tablename__ = "AgentFlowBindings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    flow_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="flowId")
    flow_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="flowVersionId")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentKnowledgeBinding(Base):
    """tenant_template.AgentKnowledgeBindings"""

    __tablename__ = "AgentKnowledgeBindings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    knowledge_collection_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="knowledgeCollectionId")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    bound_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="boundByStaffUserId")
    bound_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="boundAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentLocaleBinding(Base):
    """tenant_template.AgentLocaleBindings"""

    __tablename__ = "AgentLocaleBindings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isPrimary")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentPresence(Base):
    """tenant_template.AgentPresence"""

    __tablename__ = "AgentPresence"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    staff_user_id: Mapped[str] = mapped_column(String(4000), primary_key=True, name="staffUserId")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    status_changed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="statusChangedAt")
    active_ticket_count: Mapped[int] = mapped_column(Integer, nullable=False, name="activeTicketCount")
    max_concurrent_tickets: Mapped[int] = mapped_column(Integer, nullable=False, name="maxConcurrentTickets")
    last_heartbeat_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="lastHeartbeatAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentSandboxRun(Base):
    """tenant_template.AgentSandboxRuns"""

    __tablename__ = "AgentSandboxRuns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    transcript_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="transcriptJson")
    prompt_text: Mapped[str] = mapped_column(String(4000), nullable=False, name="promptText")
    ran_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ranByStaffUserId")
    trace_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="traceJson")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentUsageDaily(Base):
    """tenant_template.AgentUsageDaily"""

    __tablename__ = "AgentUsageDaily"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    metric_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="metricDate")
    agent_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentId")
    agent_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentVersionId")
    conversation_count: Mapped[int] = mapped_column(Integer, nullable=False, name="conversationCount")
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False, name="turnCount")
    tool_call_count: Mapped[int] = mapped_column(Integer, nullable=False, name="toolCallCount")
    input_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, name="inputTokens")
    output_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, name="outputTokens")
    cost_micro_aed: Mapped[int] = mapped_column(BigInteger, nullable=False, name="costMicroAed")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentVersion(Base):
    """tenant_template.AgentVersions"""

    __tablename__ = "AgentVersions"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentId")
    major: Mapped[int] = mapped_column(Integer, nullable=False)
    minor: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isCurrent")
    system_prompt: Mapped[str] = mapped_column(String(4000), nullable=False, name="systemPrompt")
    tone: Mapped[str] = mapped_column(String(4000), nullable=False)
    primary_model: Mapped[str] = mapped_column(String(4000), nullable=False, name="primaryModel")
    fallback_model: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fallbackModel")
    temperature: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, name="maxOutputTokens")
    change_summary: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="changeSummary")
    config_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="configHash")
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="publishedAt")
    published_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="publishedByStaffUserId")
    cloned_from_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="clonedFromVersionId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentVersionHistoryEntry(Base):
    """tenant_template.AgentVersionHistoryEntries"""

    __tablename__ = "AgentVersionHistoryEntries"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentId")
    agent_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentVersionId")
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    note: Mapped[str] = mapped_column(String(4000), nullable=False)
    from_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fromVersionId")
    actor_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="actorStaffUserId")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="occurredAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AgentWizardDraft(Base):
    """tenant_template.AgentWizardDrafts"""

    __tablename__ = "AgentWizardDrafts"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentId")
    agent_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentVersionId")
    owner_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ownerStaffUserId")
    last_step: Mapped[int] = mapped_column(Integer, nullable=False, name="lastStep")
    step_state_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="stepStateJson")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ApiConnector(Base):
    """tenant_template.ApiConnectors"""

    __tablename__ = "ApiConnectors"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    method: Mapped[str] = mapped_column(String(4000), nullable=False)
    url_template: Mapped[str] = mapped_column(String(4000), nullable=False, name="urlTemplate")
    auth_mode: Mapped[str] = mapped_column(String(4000), nullable=False, name="authMode")
    credential_secret_ref: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="credentialSecretRef")
    headers_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="headersJson")
    request_schema_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="requestSchemaJson")
    response_schema_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="responseSchemaJson")
    timeout_ms: Mapped[int] = mapped_column(Integer, nullable=False, name="timeoutMs")
    test_state: Mapped[str] = mapped_column(String(4000), nullable=False, name="testState")
    last_tested_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lastTestedAt")
    sample_response_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="sampleResponseJson")
    rate_limit_policy_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="rateLimitPolicyId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class AuditLogEntry(Base):
    """tenant_template.AuditLogEntries"""

    __tablename__ = "AuditLogEntries"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="occurredAt")
    actor_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="actorStaffUserId")
    actor_display_name_snapshot: Mapped[str] = mapped_column(String(4000), nullable=False, name="actorDisplayNameSnapshot")
    actor_role_snapshot: Mapped[str] = mapped_column(String(4000), nullable=False, name="actorRoleSnapshot")
    action: Mapped[str] = mapped_column(String(4000), nullable=False)
    target_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetKind")
    target_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="targetId")
    target_label_snapshot: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetLabelSnapshot")
    environment_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="environmentKey")
    before_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="beforeJson")
    after_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="afterJson")
    summary: Mapped[str] = mapped_column(String(4000), nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="correlationId")
    request_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="requestId")
    ip_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="ipHash")
    user_agent_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="userAgentHash")
    sequence_no: Mapped[int] = mapped_column(BigInteger, nullable=False, name="sequenceNo")
    prev_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="prevHash")
    entry_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="entryHash")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class BrandAsset(Base):
    """tenant_template.BrandAssets"""

    __tablename__ = "BrandAssets"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    file_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="fileName")
    mime_type: Mapped[str] = mapped_column(String(4000), nullable=False, name="mimeType")
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False, name="byteSize")
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    checksum: Mapped[str] = mapped_column(String(4000), nullable=False)
    storage_ref: Mapped[str] = mapped_column(String(4000), nullable=False, name="storageRef")
    uploaded_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="uploadedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Campaign(Base):
    """tenant_template.Campaigns"""

    __tablename__ = "Campaigns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    message_template_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="messageTemplateId")
    trigger: Mapped[str] = mapped_column(String(4000), nullable=False)
    trigger_offset_hours: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="triggerOffsetHours")
    audience_definition_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="audienceDefinitionJson")
    audience_label: Mapped[str] = mapped_column(String(4000), nullable=False, name="audienceLabel")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    respect_quiet_hours: Mapped[bool] = mapped_column(Boolean, nullable=False, name="respectQuietHours")
    sent_this_month: Mapped[int] = mapped_column(Integer, nullable=False, name="sentThisMonth")
    last_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lastSentAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class CampaignSend(Base):
    """tenant_template.CampaignSends"""

    __tablename__ = "CampaignSends"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    campaign_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="campaignId")
    message_template_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="messageTemplateId")
    recipient_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="recipientHash")
    citizen_identity_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="citizenIdentityId")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    suppression_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="suppressionReason")
    idempotency_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="idempotencyKey")
    bsp_message_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="bspMessageId")
    queued_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="queuedAt")
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="sentAt")
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deliveredAt")
    failure_code: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="failureCode")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class CannedReply(Base):
    """tenant_template.CannedReplies"""

    __tablename__ = "CannedReplies"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    body: Mapped[str] = mapped_column(String(4000), nullable=False)
    team_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="teamId")
    topic_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="topicKey")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Channel(Base):
    """tenant_template.Channels"""

    __tablename__ = "Channels"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    key: Mapped[str] = mapped_column(String(4000), nullable=False)
    display_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="displayName")
    bound_agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="boundAgentId")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    availability: Mapped[str] = mapped_column(String(4000), nullable=False)
    working_hours_profile_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="workingHoursProfileId")
    enabled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="enabledAt")
    disabled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="disabledAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Chunk(Base):
    """tenant_template.Chunks"""

    __tablename__ = "Chunks"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    source_document_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="sourceDocumentId")
    knowledge_source_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="knowledgeSourceId")
    knowledge_collection_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="knowledgeCollectionId")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(String(4000), nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, name="tokenCount")
    char_start: Mapped[int] = mapped_column(Integer, nullable=False, name="charStart")
    char_end: Mapped[int] = mapped_column(Integer, nullable=False, name="charEnd")
    content_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="contentHash")
    section_path: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="sectionPath")
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="pageNumber")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    embedding_model: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="embeddingModel")
    embedding_dimension: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="embeddingDimension")
    embedded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="embeddedAt")
    vector_state: Mapped[str] = mapped_column(String(4000), nullable=False, name="vectorState")
    graph_state: Mapped[str] = mapped_column(String(4000), nullable=False, name="graphState")
    erased_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="erasedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class CircuitBreakerConfig(Base):
    """tenant_template.CircuitBreakerConfigs"""

    __tablename__ = "CircuitBreakerConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    target_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetKind")
    target_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="targetId")
    target_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="targetKey")
    failure_threshold: Mapped[int] = mapped_column(Integer, nullable=False, name="failureThreshold")
    window_seconds: Mapped[int] = mapped_column(Integer, nullable=False, name="windowSeconds")
    cooldown_seconds: Mapped[int] = mapped_column(Integer, nullable=False, name="cooldownSeconds")
    half_open_probes: Mapped[int] = mapped_column(Integer, nullable=False, name="halfOpenProbes")
    fallback_strategy: Mapped[str] = mapped_column(String(4000), nullable=False, name="fallbackStrategy")
    cached_answer_max_age_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="cachedAnswerMaxAgeSeconds")
    serve_cached_when_down: Mapped[bool] = mapped_column(Boolean, nullable=False, name="serveCachedWhenDown")
    degraded_mode_message: Mapped[str] = mapped_column(String(4000), nullable=False, name="degradedModeMessage")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class CircuitBreakerEvent(Base):
    """tenant_template.CircuitBreakerEvents"""

    __tablename__ = "CircuitBreakerEvents"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    circuit_breaker_config_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="circuitBreakerConfigId")
    transition: Mapped[str] = mapped_column(String(4000), nullable=False)
    reason: Mapped[str] = mapped_column(String(4000), nullable=False)
    failure_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="failureCount")
    actor_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="actorStaffUserId")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="occurredAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class CitizenIdentity(Base):
    """tenant_template.CitizenIdentities"""

    __tablename__ = "CitizenIdentities"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    assurance_level: Mapped[str] = mapped_column(String(4000), nullable=False, name="assuranceLevel")
    emirates_id_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="emiratesIdHash")
    mobile_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="mobileHash")
    display_name_masked: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="displayNameMasked")
    verified_by_provider_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="verifiedByProviderKey")
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="verifiedAt")
    verification_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="verificationExpiresAt")
    erased_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="erasedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ConsentLedgerEntry(Base):
    """tenant_template.ConsentLedgerEntries"""

    __tablename__ = "ConsentLedgerEntries"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    subject_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="subjectKind")
    citizen_identity_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="citizenIdentityId")
    subject_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="subjectHash")
    channel_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelKey")
    purpose: Mapped[str] = mapped_column(String(4000), nullable=False)
    action: Mapped[str] = mapped_column(String(4000), nullable=False)
    evidence_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="evidenceKind")
    evidence_ref: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="evidenceRef")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="occurredAt")
    source_turn_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="sourceTurnId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ConsentState(Base):
    """tenant_template.ConsentStates"""

    __tablename__ = "ConsentStates"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    subject_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="subjectHash")
    channel_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelKey")
    purpose: Mapped[str] = mapped_column(String(4000), nullable=False)
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    last_ledger_entry_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="lastLedgerEntryId")
    effective_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="effectiveAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Conversation(Base):
    """tenant_template.Conversations"""

    __tablename__ = "Conversations"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    channel_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelKey")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    citizen_identity_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="citizenIdentityId")
    primary_agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="primaryAgentId")
    intent_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="intentKey")
    outcome: Mapped[str] = mapped_column(String(4000), nullable=False)
    was_contained: Mapped[bool] = mapped_column(Boolean, nullable=False, name="wasContained")
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False, name="turnCount")
    external_subject_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="externalSubjectHash")
    redis_session_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="redisSessionKey")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startedAt")
    last_turn_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="lastTurnAt")
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="endedAt")
    pii_mask_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, name="piiMaskApplied")
    retention_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="retentionExpiresAt")
    erased_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="erasedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ConversationMetricsDaily(Base):
    """tenant_template.ConversationMetricsDaily"""

    __tablename__ = "ConversationMetricsDaily"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    metric_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="metricDate")
    channel_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelKey")
    agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentId")
    conversation_count: Mapped[int] = mapped_column(Integer, nullable=False, name="conversationCount")
    contained_count: Mapped[int] = mapped_column(Integer, nullable=False, name="containedCount")
    deflected_count: Mapped[int] = mapped_column(Integer, nullable=False, name="deflectedCount")
    escalated_count: Mapped[int] = mapped_column(Integer, nullable=False, name="escalatedCount")
    abandoned_count: Mapped[int] = mapped_column(Integer, nullable=False, name="abandonedCount")
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False, name="turnCount")
    tool_call_count: Mapped[int] = mapped_column(Integer, nullable=False, name="toolCallCount")
    tool_error_count: Mapped[int] = mapped_column(Integer, nullable=False, name="toolErrorCount")
    thumbs_up_count: Mapped[int] = mapped_column(Integer, nullable=False, name="thumbsUpCount")
    thumbs_down_count: Mapped[int] = mapped_column(Integer, nullable=False, name="thumbsDownCount")
    avg_first_response_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="avgFirstResponseMs")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ConversationSlot(Base):
    """tenant_template.ConversationSlots"""

    __tablename__ = "ConversationSlots"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="conversationId")
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    value_masked: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="valueMasked")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    required_assurance: Mapped[str] = mapped_column(String(4000), nullable=False, name="requiredAssurance")
    opened_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="openedAt")
    filled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="filledAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ConversationTurn(Base):
    """tenant_template.ConversationTurns"""

    __tablename__ = "ConversationTurns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="conversationId")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(4000), nullable=False)
    content_masked: Mapped[str] = mapped_column(String(4000), nullable=False, name="contentMasked")
    content_format: Mapped[str] = mapped_column(String(4000), nullable=False, name="contentFormat")
    agent_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentVersionId")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="inputTokens")
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="outputTokens")
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="latencyMs")
    was_refused: Mapped[bool] = mapped_column(Boolean, nullable=False, name="wasRefused")
    refusal_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="refusalReason")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Environment(Base):
    """platform.Environments"""

    __tablename__ = "Environments"
    __table_args__ = {"schema": "platform"}

    key: Mapped[str] = mapped_column(String(4000), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="displayName")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    promotes_to_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="promotesToKey")
    is_live: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isLive")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ErasureRequest(Base):
    """tenant_template.ErasureRequests"""

    __tablename__ = "ErasureRequests"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    subject_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="subjectKind")
    subject_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="subjectHash")
    citizen_identity_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="citizenIdentityId")
    received_via: Mapped[str] = mapped_column(String(4000), nullable=False, name="receivedVia")
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="requestedAt")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    rejection_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="rejectionReason")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="completedAt")
    verification_evidence_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="verificationEvidenceJson")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ErasureTask(Base):
    """tenant_template.ErasureTasks"""

    __tablename__ = "ErasureTasks"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    erasure_request_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="erasureRequestId")
    store: Mapped[str] = mapped_column(String(4000), nullable=False)
    scope_description: Mapped[str] = mapped_column(String(4000), nullable=False, name="scopeDescription")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    affected_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="affectedCount")
    verification_query: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="verificationQuery")
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="verifiedAt")
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="startedAt")
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="finishedAt")
    error: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class EscalationTicket(Base):
    """tenant_template.EscalationTickets"""

    __tablename__ = "EscalationTickets"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="conversationId")
    topic: Mapped[str] = mapped_column(String(4000), nullable=False)
    topic_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="topicKey")
    channel_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelKey")
    priority: Mapped[str] = mapped_column(String(4000), nullable=False)
    reason: Mapped[str] = mapped_column(String(4000), nullable=False)
    reason_detail: Mapped[str] = mapped_column(String(4000), nullable=False, name="reasonDetail")
    origin_flow_node_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="originFlowNodeId")
    customer_context_summary: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="customerContextSummary")
    verification_state: Mapped[str] = mapped_column(String(4000), nullable=False, name="verificationState")
    citizen_identity_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="citizenIdentityId")
    pending_slot_name: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pendingSlotName")
    context_snapshot_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="contextSnapshotJson")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    routed_by_routing_rule_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="routedByRoutingRuleId")
    route_target_team_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="routeTargetTeamId")
    was_requeued: Mapped[bool] = mapped_column(Boolean, nullable=False, name="wasRequeued")
    assigned_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="assignedStaffUserId")
    queued_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="queuedAt")
    assigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="assignedAt")
    first_response_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="firstResponseAt")
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="resolvedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class FeedbackIssue(Base):
    """tenant_template.FeedbackIssues"""

    __tablename__ = "FeedbackIssues"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    question_text: Mapped[str] = mapped_column(String(4000), nullable=False, name="questionText")
    cluster_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="clusterKey")
    volume: Mapped[int] = mapped_column(Integer, nullable=False)
    root_cause: Mapped[str] = mapped_column(String(4000), nullable=False, name="rootCause")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    linked_knowledge_source_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="linkedKnowledgeSourceId")
    linked_flow_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="linkedFlowId")
    linked_golden_case_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="linkedGoldenCaseId")
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="firstSeenAt")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="lastSeenAt")
    fixed_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fixedByStaffUserId")
    fixed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="fixedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Flow(Base):
    """tenant_template.Flows"""

    __tablename__ = "Flows"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    slug: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    owner_tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ownerTenantId")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    current_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="currentVersionId")
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class FlowAssistantConfig(Base):
    """tenant_template.FlowAssistantConfigs"""

    __tablename__ = "FlowAssistantConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    primary_model: Mapped[str] = mapped_column(String(4000), nullable=False, name="primaryModel")
    fallback_model: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fallbackModel")
    updated_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class FlowEdge(Base):
    """tenant_template.FlowEdges"""

    __tablename__ = "FlowEdges"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    flow_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="flowVersionId")
    from_node_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="fromNodeId")
    to_node_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="toNodeId")
    label: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    condition_expression: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="conditionExpression")
    is_default_branch: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isDefaultBranch")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class FlowNode(Base):
    """tenant_template.FlowNodes"""

    __tablename__ = "FlowNodes"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    flow_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="flowVersionId")
    key: Mapped[str] = mapped_column(String(4000), nullable=False)
    type: Mapped[str] = mapped_column(String(4000), nullable=False)
    title: Mapped[str] = mapped_column(String(4000), nullable=False)
    canvas_x: Mapped[int] = mapped_column(Integer, nullable=False, name="canvasX")
    canvas_y: Mapped[int] = mapped_column(Integer, nullable=False, name="canvasY")
    message_text: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="messageText")
    quick_action_set_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="quickActionSetKey")
    slot_name: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="slotName")
    option_source_kind: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="optionSourceKind")
    option_source_ref: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="optionSourceRef")
    static_options_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="staticOptionsJson")
    tool_binding_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="toolBindingId")
    retry_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="retryCount")
    retry_on_timeout: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, name="retryOnTimeout")
    timeout_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="timeoutMs")
    on_failure_node_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="onFailureNodeId")
    handover_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="handoverReason")
    confidence_threshold: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="confidenceThreshold")
    condition_expression: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="conditionExpression")
    required_assurance: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="requiredAssurance")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class FlowVersion(Base):
    """tenant_template.FlowVersions"""

    __tablename__ = "FlowVersions"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    flow_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="flowId")
    major: Mapped[int] = mapped_column(Integer, nullable=False)
    minor: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isCurrent")
    entry_node_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="entryNodeId")
    free_text_escape_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="freeTextEscapeEnabled")
    escape_node_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="escapeNodeId")
    change_summary: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="changeSummary")
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="publishedAt")
    published_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="publishedByStaffUserId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GateEvaluation(Base):
    """tenant_template.GateEvaluations"""

    __tablename__ = "GateEvaluations"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    evaluated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="evaluatedAt")
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    gate_snapshot_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="gateSnapshotJson")
    blocking_reasons_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="blockingReasonsJson")
    evaluated_for_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="evaluatedForKind")
    promotion_request_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="promotionRequestId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GoldenCase(Base):
    """tenant_template.GoldenCases"""

    __tablename__ = "GoldenCases"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    golden_set_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="goldenSetId")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt: Mapped[str] = mapped_column(String(4000), nullable=False)
    expected_behaviour: Mapped[str] = mapped_column(String(4000), nullable=False, name="expectedBehaviour")
    expected_tool_calls_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="expectedToolCallsJson")
    expected_citation_source_ids_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="expectedCitationSourceIdsJson")
    must_refuse: Mapped[bool] = mapped_column(Boolean, nullable=False, name="mustRefuse")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    source_conversation_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="sourceConversationId")
    added_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="addedByStaffUserId")
    added_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="addedAt")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GoldenSet(Base):
    """tenant_template.GoldenSets"""

    __tablename__ = "GoldenSets"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    owner_tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ownerTenantId")
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    locale_code: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="localeCode")
    case_count: Mapped[int] = mapped_column(Integer, nullable=False, name="caseCount")
    last_score: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="lastScore")
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lastRunAt")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GraphDuplicateCandidate(Base):
    """tenant_template.GraphDuplicateCandidates"""

    __tablename__ = "GraphDuplicateCandidates"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    left_node_record_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="leftNodeRecordId")
    right_node_record_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="rightNodeRecordId")
    similarity: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    detection_method: Mapped[str] = mapped_column(String(4000), nullable=False, name="detectionMethod")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="detectedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GraphEdgeRecord(Base):
    """tenant_template.GraphEdgeRecords"""

    __tablename__ = "GraphEdgeRecords"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    from_node_record_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="fromNodeRecordId")
    to_node_record_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="toNodeRecordId")
    relationship_type: Mapped[str] = mapped_column(String(4000), nullable=False, name="relationshipType")
    properties_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="propertiesJson")
    origin: Mapped[str] = mapped_column(String(4000), nullable=False)
    evidence_chunk_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="evidenceChunkId")
    confidence: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GraphMergeDecision(Base):
    """tenant_template.GraphMergeDecisions"""

    __tablename__ = "GraphMergeDecisions"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    graph_duplicate_candidate_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="graphDuplicateCandidateId")
    decision: Mapped[str] = mapped_column(String(4000), nullable=False)
    surviving_node_record_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="survivingNodeRecordId")
    absorbed_node_record_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="absorbedNodeRecordId")
    aliases_added_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="aliasesAddedJson")
    edges_rewired_count: Mapped[int] = mapped_column(Integer, nullable=False, name="edgesRewiredCount")
    decided_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="decidedByStaffUserId")
    decided_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="decidedAt")
    reindex_job_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="reindexJobId")
    reverted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="revertedAt")
    reverted_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="revertedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GraphNodeRecord(Base):
    """tenant_template.GraphNodeRecords"""

    __tablename__ = "GraphNodeRecords"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    label: Mapped[str] = mapped_column(String(4000), nullable=False)
    canonical_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="canonicalKey")
    canonical_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="canonicalName")
    aliases_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="aliasesJson")
    properties_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="propertiesJson")
    origin: Mapped[str] = mapped_column(String(4000), nullable=False)
    authored_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="authoredByStaffUserId")
    first_seen_chunk_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="firstSeenChunkId")
    merged_into_node_record_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="mergedIntoNodeRecordId")
    merged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="mergedAt")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GroundingCitation(Base):
    """tenant_template.GroundingCitations"""

    __tablename__ = "GroundingCitations"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    trace_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="traceId")
    turn_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="turnId")
    chunk_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="chunkId")
    knowledge_source_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="knowledgeSourceId")
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    vector_score: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="vectorScore")
    graph_score: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="graphScore")
    hybrid_score: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="hybridScore")
    rerank_score: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="rerankScore")
    retrieved_via: Mapped[str] = mapped_column(String(4000), nullable=False, name="retrievedVia")
    graph_path: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="graphPath")
    was_cited: Mapped[bool] = mapped_column(Boolean, nullable=False, name="wasCited")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GuideAsset(Base):
    """platform.GuideAssets"""

    __tablename__ = "GuideAssets"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    file_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="fileName")
    mime_type: Mapped[str] = mapped_column(String(4000), nullable=False, name="mimeType")
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False, name="byteSize")
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum: Mapped[str] = mapped_column(String(4000), nullable=False)
    storage_ref: Mapped[str] = mapped_column(String(4000), nullable=False, name="storageRef")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GuideCoverageCheck(Base):
    """platform.GuideCoverageChecks"""

    __tablename__ = "GuideCoverageChecks"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    app_route: Mapped[str] = mapped_column(String(4000), nullable=False, name="appRoute")
    discovered_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="discoveredAt")
    guide_entry_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="guideEntryId")
    has_entry: Mapped[bool] = mapped_column(Boolean, nullable=False, name="hasEntry")
    has_current_screenshot: Mapped[bool] = mapped_column(Boolean, nullable=False, name="hasCurrentScreenshot")
    last_checked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="lastCheckedAt")
    release_version: Mapped[str] = mapped_column(String(4000), nullable=False, name="releaseVersion")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GuideEntry(Base):
    """platform.GuideEntries"""

    __tablename__ = "GuideEntries"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    guide_section_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="guideSectionId")
    slug: Mapped[str] = mapped_column(String(4000), nullable=False)
    title: Mapped[str] = mapped_column(String(4000), nullable=False)
    purpose: Mapped[str] = mapped_column(String(4000), nullable=False)
    walkthrough_markdown: Mapped[str] = mapped_column(String(4000), nullable=False, name="walkthroughMarkdown")
    how_to_steps_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="howToStepsJson")
    permission_notes_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="permissionNotesJson")
    app_route: Mapped[str] = mapped_column(String(4000), nullable=False, name="appRoute")
    screen_ref: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="screenRef")
    release_version: Mapped[str] = mapped_column(String(4000), nullable=False, name="releaseVersion")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    updated_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GuideEntryTranslation(Base):
    """platform.GuideEntryTranslations"""

    __tablename__ = "GuideEntryTranslations"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    guide_entry_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="guideEntryId")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    title: Mapped[str] = mapped_column(String(4000), nullable=False)
    purpose: Mapped[str] = mapped_column(String(4000), nullable=False)
    walkthrough_markdown: Mapped[str] = mapped_column(String(4000), nullable=False, name="walkthroughMarkdown")
    how_to_steps_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="howToStepsJson")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GuideScreenshot(Base):
    """platform.GuideScreenshots"""

    __tablename__ = "GuideScreenshots"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    guide_entry_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="guideEntryId")
    guide_asset_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="guideAssetId")
    caption: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="capturedAt")
    captured_app_version: Mapped[str] = mapped_column(String(4000), nullable=False, name="capturedAppVersion")
    is_stale: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isStale")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class GuideSection(Base):
    """platform.GuideSections"""

    __tablename__ = "GuideSections"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    parent_section_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="parentSectionId")
    title: Mapped[str] = mapped_column(String(4000), nullable=False)
    slug: Mapped[str] = mapped_column(String(4000), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    module_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="moduleKey")
    depth: Mapped[int] = mapped_column(Integer, nullable=False)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isPublished")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class HandoverConfig(Base):
    """tenant_template.HandoverConfigs"""

    __tablename__ = "HandoverConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    default_queue_team_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="defaultQueueTeamId")
    max_wait_seconds_before_requeue: Mapped[int] = mapped_column(Integer, nullable=False, name="maxWaitSecondsBeforeRequeue")
    supervisor_alert_team_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="supervisorAlertTeamId")
    working_hours_profile_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="workingHoursProfileId")
    no_agent_available_message: Mapped[str] = mapped_column(String(4000), nullable=False, name="noAgentAvailableMessage")
    offer_escalation_outside_hours: Mapped[bool] = mapped_column(Boolean, nullable=False, name="offerEscalationOutsideHours")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class IdentityLink(Base):
    """tenant_template.IdentityLinks"""

    __tablename__ = "IdentityLinks"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    citizen_identity_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="citizenIdentityId")
    channel_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelKey")
    channel_subject_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelSubjectHash")
    assurance_level_at_link: Mapped[str] = mapped_column(String(4000), nullable=False, name="assuranceLevelAtLink")
    stitching_key_used: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="stitchingKeyUsed")
    linked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="linkedAt")
    unlinked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="unlinkedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class IdentityStitchingConfig(Base):
    """tenant_template.IdentityStitchingConfigs"""

    __tablename__ = "IdentityStitchingConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    stitch_across_channels: Mapped[bool] = mapped_column(Boolean, nullable=False, name="stitchAcrossChannels")
    stitching_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="stitchingKey")
    conversation_memory_scope: Mapped[str] = mapped_column(String(4000), nullable=False, name="conversationMemoryScope")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class IngestionRun(Base):
    """tenant_template.IngestionRuns"""

    __tablename__ = "IngestionRuns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    knowledge_source_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="knowledgeSourceId")
    trigger: Mapped[str] = mapped_column(String(4000), nullable=False)
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    documents_seen: Mapped[int] = mapped_column(Integer, nullable=False, name="documentsSeen")
    documents_added: Mapped[int] = mapped_column(Integer, nullable=False, name="documentsAdded")
    documents_updated: Mapped[int] = mapped_column(Integer, nullable=False, name="documentsUpdated")
    documents_removed: Mapped[int] = mapped_column(Integer, nullable=False, name="documentsRemoved")
    chunks_written: Mapped[int] = mapped_column(Integer, nullable=False, name="chunksWritten")
    chunks_skipped_unchanged: Mapped[int] = mapped_column(Integer, nullable=False, name="chunksSkippedUnchanged")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startedAt")
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="finishedAt")
    error: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    ran_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="ranByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class IntentMetricsDaily(Base):
    """tenant_template.IntentMetricsDaily"""

    __tablename__ = "IntentMetricsDaily"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    metric_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="metricDate")
    intent_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="intentKey")
    intent_label: Mapped[str] = mapped_column(String(4000), nullable=False, name="intentLabel")
    conversation_count: Mapped[int] = mapped_column(Integer, nullable=False, name="conversationCount")
    escalated_count: Mapped[int] = mapped_column(Integer, nullable=False, name="escalatedCount")
    resolved_count: Mapped[int] = mapped_column(Integer, nullable=False, name="resolvedCount")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class KnowledgeCollection(Base):
    """tenant_template.KnowledgeCollections"""

    __tablename__ = "KnowledgeCollections"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    slug: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    owner_tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ownerTenantId")
    retrieval_config_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="retrievalConfigId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class KnowledgeSource(Base):
    """tenant_template.KnowledgeSources"""

    __tablename__ = "KnowledgeSources"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    knowledge_collection_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="knowledgeCollectionId")
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    source_type: Mapped[str] = mapped_column(String(4000), nullable=False, name="sourceType")
    location: Mapped[str] = mapped_column(String(4000), nullable=False)
    owner_tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ownerTenantId")
    schedule: Mapped[str] = mapped_column(String(4000), nullable=False)
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    document_count: Mapped[int] = mapped_column(Integer, nullable=False, name="documentCount")
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, name="chunkCount")
    indexed_chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, name="indexedChunkCount")
    last_crawled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lastCrawledAt")
    next_scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="nextScheduledAt")
    last_error: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="lastError")
    credential_secret_ref: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="credentialSecretRef")
    removed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="removedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class LinkedServiceAccount(Base):
    """tenant_template.LinkedServiceAccounts"""

    __tablename__ = "LinkedServiceAccounts"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    citizen_identity_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="citizenIdentityId")
    provider_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="providerKey")
    account_number_masked: Mapped[str] = mapped_column(String(4000), nullable=False, name="accountNumberMasked")
    account_number_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="accountNumberHash")
    ownership_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, name="ownershipVerified")
    ownership_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="ownershipVerifiedAt")
    ownership_verified_via: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="ownershipVerifiedVia")
    linked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="linkedAt")
    unlinked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="unlinkedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Locale(Base):
    """platform.Locales"""

    __tablename__ = "Locales"
    __table_args__ = {"schema": "platform"}

    code: Mapped[str] = mapped_column(String(4000), primary_key=True)
    english_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="englishName")
    native_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="nativeName")
    direction: Mapped[str] = mapped_column(String(4000), nullable=False)
    default_voice_name: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="defaultVoiceName")
    is_enabled_platform_wide: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabledPlatformWide")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class LocaleSetting(Base):
    """tenant_template.LocaleSettings"""

    __tablename__ = "LocaleSettings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    voice_name: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="voiceName")
    translated_string_count: Mapped[int] = mapped_column(Integer, nullable=False, name="translatedStringCount")
    total_string_count: Mapped[int] = mapped_column(Integer, nullable=False, name="totalStringCount")
    is_fallback: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isFallback")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class McpServer(Base):
    """tenant_template.McpServers"""

    __tablename__ = "McpServers"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(4000), nullable=False)
    transport: Mapped[str] = mapped_column(String(4000), nullable=False)
    auth_mode: Mapped[str] = mapped_column(String(4000), nullable=False, name="authMode")
    credential_secret_ref: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="credentialSecretRef")
    connection_state: Mapped[str] = mapped_column(String(4000), nullable=False, name="connectionState")
    last_discovery_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lastDiscoveryAt")
    last_connected_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lastConnectedAt")
    last_error: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="lastError")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class McpTool(Base):
    """tenant_template.McpTools"""

    __tablename__ = "McpTools"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    mcp_server_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="mcpServerId")
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    input_schema_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="inputSchemaJson")
    discovered_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="discoveredAt")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="lastSeenAt")
    removed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="removedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class MessageFeedback(Base):
    """tenant_template.MessageFeedback"""

    __tablename__ = "MessageFeedback"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    turn_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="turnId")
    rating: Mapped[str] = mapped_column(String(4000), nullable=False)
    reason_tag: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="reasonTag")
    comment: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    submitted_by_citizen: Mapped[bool] = mapped_column(Boolean, nullable=False, name="submittedByCitizen")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class MessageTemplate(Base):
    """tenant_template.MessageTemplates"""

    __tablename__ = "MessageTemplates"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    channel_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelKey")
    category: Mapped[str] = mapped_column(String(4000), nullable=False)
    body_sample: Mapped[str] = mapped_column(String(4000), nullable=False, name="bodySample")
    variables_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="variablesJson")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    approval_status: Mapped[str] = mapped_column(String(4000), nullable=False, name="approvalStatus")
    bsp_template_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="bspTemplateId")
    submitted_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="submittedByStaffUserId")
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="submittedAt")
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="reviewedAt")
    rejection_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="rejectionReason")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class MigrationRun(Base):
    """platform.MigrationRuns"""

    __tablename__ = "MigrationRuns"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    migration_names_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="migrationNamesJson")
    initiated_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="initiatedByStaffUserId")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    tenants_total: Mapped[int] = mapped_column(Integer, nullable=False, name="tenantsTotal")
    tenants_applied: Mapped[int] = mapped_column(Integer, nullable=False, name="tenantsApplied")
    tenants_failed: Mapped[int] = mapped_column(Integer, nullable=False, name="tenantsFailed")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startedAt")
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="finishedAt")
    resumed_from_run_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="resumedFromRunId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class OrchestrationTrace(Base):
    """tenant_template.OrchestrationTraces"""

    __tablename__ = "OrchestrationTraces"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="conversationId")
    turn_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="turnId")
    execution_mode: Mapped[str] = mapped_column(String(4000), nullable=False, name="executionMode")
    routed_agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="routedAgentId")
    routed_agent_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="routedAgentVersionId")
    routing_confidence: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="routingConfidence")
    hop_count: Mapped[int] = mapped_column(Integer, nullable=False, name="hopCount")
    total_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, name="totalInputTokens")
    total_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, name="totalOutputTokens")
    total_cost_micro_aed: Mapped[int] = mapped_column(BigInteger, nullable=False, name="totalCostMicroAed")
    pending_slot_name: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pendingSlotName")
    escape_triggered: Mapped[bool] = mapped_column(Boolean, nullable=False, name="escapeTriggered")
    merge_policy_applied: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="mergePolicyApplied")
    guardrail_pre_result: Mapped[str] = mapped_column(String(4000), nullable=False, name="guardrailPreResult")
    guardrail_post_result: Mapped[str] = mapped_column(String(4000), nullable=False, name="guardrailPostResult")
    grounding_confidence: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="groundingConfidence")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startedAt")
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, name="durationMs")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")
    pipeline_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pipelineVersionId")
    pipeline_design_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pipelineDesignId")
    pipeline_label: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pipelineLabel")
    terminal_node_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="terminalNodeKey")
    branch_count: Mapped[int] = mapped_column(Integer, nullable=False, name="branchCount")
    loop_iterations_total: Mapped[int] = mapped_column(Integer, nullable=False, name="loopIterationsTotal")


class OrchestrationTraceStep(Base):
    """tenant_template.OrchestrationTraceSteps"""

    __tablename__ = "OrchestrationTraceSteps"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    trace_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="traceId")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentId")
    tool_binding_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="toolBindingId")
    label: Mapped[str] = mapped_column(String(4000), nullable=False)
    arguments_masked: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="argumentsMasked")
    result_summary: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="resultSummary")
    confidence: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True)
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    error_code: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="errorCode")
    is_secondary_agent: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isSecondaryAgent")
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, name="durationMs")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")
    pipeline_node_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pipelineNodeId")
    pipeline_node_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pipelineNodeKey")
    pipeline_edge_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pipelineEdgeId")
    from_node_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fromNodeKey")
    edge_kind: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="edgeKind")
    branch_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="branchId")
    loop_iteration: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="loopIteration")
    depth: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class OutboxEvent(Base):
    """tenant_template.OutboxEvents"""

    __tablename__ = "OutboxEvents"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    aggregate_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="aggregateKind")
    aggregate_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="aggregateId")
    event_type: Mapped[str] = mapped_column(String(4000), nullable=False, name="eventType")
    target_store: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetStore")
    payload_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="payloadJson")
    dedupe_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="dedupeKey")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, name="attemptCount")
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, name="maxAttempts")
    available_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="availableAt")
    locked_by: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="lockedBy")
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lockedUntil")
    last_error: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="lastError")
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="appliedAt")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="occurredAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class OverridablePolicy(Base):
    """platform.OverridablePolicies"""

    __tablename__ = "OverridablePolicies"
    __table_args__ = {"schema": "platform"}

    policy_key: Mapped[str] = mapped_column(String(4000), primary_key=True, name="policyKey")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PaymentEvent(Base):
    """tenant_template.PaymentEvents"""

    __tablename__ = "PaymentEvents"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    transaction_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="transactionId")
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    gateway_event_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="gatewayEventId")
    payload_redacted_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="payloadRedactedJson")
    signature_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, name="signatureVerified")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="occurredAt")
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="receivedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PaymentGateway(Base):
    """tenant_template.PaymentGateways"""

    __tablename__ = "PaymentGateways"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    key: Mapped[str] = mapped_column(String(4000), nullable=False)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    methods_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="methodsJson")
    mode: Mapped[str] = mapped_column(String(4000), nullable=False)
    credential_secret_ref: Mapped[str] = mapped_column(String(4000), nullable=False, name="credentialSecretRef")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    supports_refunds: Mapped[bool] = mapped_column(Boolean, nullable=False, name="supportsRefunds")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Permission(Base):
    """platform.Permissions"""

    __tablename__ = "Permissions"
    __table_args__ = {"schema": "platform"}

    key: Mapped[str] = mapped_column(String(4000), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="displayName")
    module_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="moduleKey")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(String(4000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PipelineDesign(Base):
    """tenant_template.PipelineDesigns"""

    __tablename__ = "PipelineDesigns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    slug: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    owner_tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ownerTenantId")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    current_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="currentVersionId")
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PipelineEdge(Base):
    """tenant_template.PipelineEdges"""

    __tablename__ = "PipelineEdges"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    pipeline_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="pipelineVersionId")
    from_node_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="fromNodeId")
    to_node_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="toNodeId")
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    max_iterations: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="maxIterations")
    condition_expression: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="conditionExpression")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PipelineNode(Base):
    """tenant_template.PipelineNodes"""

    __tablename__ = "PipelineNodes"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    pipeline_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="pipelineVersionId")
    key: Mapped[str] = mapped_column(String(4000), nullable=False)
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    title: Mapped[str] = mapped_column(String(4000), nullable=False)
    canvas_x: Mapped[int] = mapped_column(Integer, nullable=False, name="canvasX")
    canvas_y: Mapped[int] = mapped_column(Integer, nullable=False, name="canvasY")
    agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentId")
    uses_turn_bound_agent: Mapped[bool] = mapped_column(Boolean, nullable=False, name="usesTurnBoundAgent")
    agent_version_pin_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentVersionPinId")
    input_context_mode: Mapped[str] = mapped_column(String(4000), nullable=False, name="inputContextMode")
    merge_policy_override: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="mergePolicyOverride")
    conflict_resolution_override: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="conflictResolutionOverride")
    is_owning_entity: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isOwningEntity")
    cost_ceiling_tokens_override: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="costCeilingTokensOverride")
    cost_ceiling_micro_aed_override: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, name="costCeilingMicroAedOverride")
    timeout_ms_override: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="timeoutMsOverride")
    on_error_policy: Mapped[str] = mapped_column(String(4000), nullable=False, name="onErrorPolicy")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PipelineVersion(Base):
    """tenant_template.PipelineVersions"""

    __tablename__ = "PipelineVersions"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    pipeline_design_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="pipelineDesignId")
    major: Mapped[int] = mapped_column(Integer, nullable=False)
    minor: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isCurrent")
    entry_node_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="entryNodeId")
    max_total_hops: Mapped[int] = mapped_column(Integer, nullable=False, name="maxTotalHops")
    cost_ceiling_tokens: Mapped[int] = mapped_column(Integer, nullable=False, name="costCeilingTokens")
    cost_ceiling_micro_aed: Mapped[int] = mapped_column(BigInteger, nullable=False, name="costCeilingMicroAed")
    default_merge_policy: Mapped[str] = mapped_column(String(4000), nullable=False, name="defaultMergePolicy")
    default_conflict_resolution: Mapped[str] = mapped_column(String(4000), nullable=False, name="defaultConflictResolution")
    routing_strategy: Mapped[str] = mapped_column(String(4000), nullable=False, name="routingStrategy")
    min_routing_confidence: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="minRoutingConfidence")
    fallback_agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fallbackAgentId")
    change_summary: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="changeSummary")
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="publishedAt")
    published_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="publishedByStaffUserId")
    cloned_from_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="clonedFromVersionId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PipelineVersionHistoryEntry(Base):
    """tenant_template.PipelineVersionHistoryEntries"""

    __tablename__ = "PipelineVersionHistoryEntries"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    pipeline_design_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="pipelineDesignId")
    pipeline_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="pipelineVersionId")
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    note: Mapped[str] = mapped_column(String(4000), nullable=False)
    from_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fromVersionId")
    actor_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="actorStaffUserId")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="occurredAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PlatformAuditLogEntry(Base):
    """platform.PlatformAuditLogEntries"""

    __tablename__ = "PlatformAuditLogEntries"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="occurredAt")
    actor_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="actorStaffUserId")
    actor_display_name_snapshot: Mapped[str] = mapped_column(String(4000), nullable=False, name="actorDisplayNameSnapshot")
    actor_role_snapshot: Mapped[str] = mapped_column(String(4000), nullable=False, name="actorRoleSnapshot")
    action: Mapped[str] = mapped_column(String(4000), nullable=False)
    target_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetKind")
    target_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="targetId")
    target_label_snapshot: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetLabelSnapshot")
    environment_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="environmentKey")
    before_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="beforeJson")
    after_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="afterJson")
    summary: Mapped[str] = mapped_column(String(4000), nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="correlationId")
    request_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="requestId")
    ip_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="ipHash")
    user_agent_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="userAgentHash")
    sequence_no: Mapped[int] = mapped_column(BigInteger, nullable=False, name="sequenceNo")
    prev_hash: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="prevHash")
    entry_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="entryHash")
    tenant_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="tenantId")
    tenant_slug_snapshot: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="tenantSlugSnapshot")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PlatformErasureRequest(Base):
    """platform.ErasureRequests"""

    __tablename__ = "ErasureRequests"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    subject_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="subjectKind")
    subject_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="subjectHash")
    tenant_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="tenantId")
    tenant_slug_snapshot: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="tenantSlugSnapshot")
    received_via: Mapped[str] = mapped_column(String(4000), nullable=False, name="receivedVia")
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="requestedAt")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    rejection_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="rejectionReason")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="completedAt")
    verification_evidence_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="verificationEvidenceJson")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PlatformSkin(Base):
    """platform.Skins"""

    __tablename__ = "Skins"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    light_token_set_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="lightTokenSetId")
    dark_token_set_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="darkTokenSetId")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isSystem")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    duplicated_from_skin_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="duplicatedFromSkinId")
    export_schema_version: Mapped[int] = mapped_column(Integer, nullable=False, name="exportSchemaVersion")
    created_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="createdByStaffUserId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PlatformTokenSet(Base):
    """platform.TokenSets"""

    __tablename__ = "TokenSets"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    mode: Mapped[str] = mapped_column(String(4000), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, name="schemaVersion")
    tokens_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="tokensJson")
    parent_token_set_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="parentTokenSetId")
    contrast_validated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="contrastValidatedAt")
    contrast_report_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="contrastReportJson")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Policy(Base):
    """platform.Policies"""

    __tablename__ = "Policies"
    __table_args__ = {"schema": "platform"}

    policy_key: Mapped[str] = mapped_column(String(4000), primary_key=True, name="policyKey")
    title: Mapped[str] = mapped_column(String(4000), nullable=False)
    detail: Mapped[str] = mapped_column(String(4000), nullable=False)
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    default_value_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="defaultValueJson")
    floor_value_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="floorValueJson")
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isLocked")
    applies_to: Mapped[str] = mapped_column(String(4000), nullable=False, name="appliesTo")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PolicyOverride(Base):
    """tenant_template.PolicyOverrides"""

    __tablename__ = "PolicyOverrides"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentId")
    policy_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="policyKey")
    mode: Mapped[str] = mapped_column(String(4000), nullable=False)
    value_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="valueJson")
    reason: Mapped[str] = mapped_column(String(4000), nullable=False)
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    removed_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="removedByStaffUserId")
    removed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="removedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PolicySetting(Base):
    """tenant_template.PolicySettings"""

    __tablename__ = "PolicySettings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    policy_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="policyKey")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    value_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="valueJson")
    updated_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PrivacyConfig(Base):
    """tenant_template.PrivacyConfigs"""

    __tablename__ = "PrivacyConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    consent_ledger_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="consentLedgerEnabled")
    honour_erasure_requests: Mapped[bool] = mapped_column(Boolean, nullable=False, name="honourErasureRequests")
    transcript_retention: Mapped[str] = mapped_column(String(4000), nullable=False, name="transcriptRetention")
    data_residency: Mapped[str] = mapped_column(String(4000), nullable=False, name="dataResidency")
    updated_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PromotionRequest(Base):
    """tenant_template.PromotionRequests"""

    __tablename__ = "PromotionRequests"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    from_environment_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="fromEnvironmentKey")
    to_environment_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="toEnvironmentKey")
    requested_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="requestedByStaffUserId")
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="requestedAt")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    gate_evaluation_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="gateEvaluationId")
    decided_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="decidedByStaffUserId")
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="decidedAt")
    decision_note: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="decisionNote")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PublicHoliday(Base):
    """tenant_template.PublicHolidays"""

    __tablename__ = "PublicHolidays"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    holiday_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="holidayDate")
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    origin: Mapped[str] = mapped_column(String(4000), nullable=False)
    is_observed: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isObserved")
    synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="syncedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class PublishGate(Base):
    """tenant_template.PublishGates"""

    __tablename__ = "PublishGates"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    block_on_suite_failure: Mapped[bool] = mapped_column(Boolean, nullable=False, name="blockOnSuiteFailure")
    min_accuracy: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="minAccuracy")
    min_groundedness: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="minGroundedness")
    red_team_must_score100: Mapped[bool] = mapped_column(Boolean, nullable=False, name="redTeamMustScore100")
    block_on_bound_locale_below100: Mapped[bool] = mapped_column(Boolean, nullable=False, name="blockOnBoundLocaleBelow100")
    updated_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class QuickAction(Base):
    """tenant_template.QuickActions"""

    __tablename__ = "QuickActions"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    label: Mapped[str] = mapped_column(String(4000), nullable=False)
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    payload_intent_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="payloadIntentKey")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    channel_scope: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelScope")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class QuietHoursConfig(Base):
    """tenant_template.QuietHoursConfigs"""

    __tablename__ = "QuietHoursConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startsAt")
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="endsAt")
    timezone: Mapped[str] = mapped_column(String(4000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RateLimitPolicy(Base):
    """tenant_template.RateLimitPolicies"""

    __tablename__ = "RateLimitPolicies"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    requests_per_window: Mapped[int] = mapped_column(Integer, nullable=False, name="requestsPerWindow")
    window_seconds: Mapped[int] = mapped_column(Integer, nullable=False, name="windowSeconds")
    burst: Mapped[int] = mapped_column(Integer, nullable=False)
    scope: Mapped[str] = mapped_column(String(4000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ReceiptConfig(Base):
    """tenant_template.ReceiptConfigs"""

    __tablename__ = "ReceiptConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    send_in_conversation: Mapped[bool] = mapped_column(Boolean, nullable=False, name="sendInConversation")
    email_pdf_copy: Mapped[bool] = mapped_column(Boolean, nullable=False, name="emailPdfCopy")
    allow_refund_requests_from_assistant: Mapped[bool] = mapped_column(Boolean, nullable=False, name="allowRefundRequestsFromAssistant")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ReconciliationRun(Base):
    """tenant_template.ReconciliationRuns"""

    __tablename__ = "ReconciliationRuns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    store: Mapped[str] = mapped_column(String(4000), nullable=False)
    scope: Mapped[str] = mapped_column(String(4000), nullable=False)
    knowledge_source_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="knowledgeSourceId")
    expected_count: Mapped[int] = mapped_column(Integer, nullable=False, name="expectedCount")
    observed_count: Mapped[int] = mapped_column(Integer, nullable=False, name="observedCount")
    drift_found: Mapped[int] = mapped_column(Integer, nullable=False, name="driftFound")
    drift_repaired: Mapped[int] = mapped_column(Integer, nullable=False, name="driftRepaired")
    dead_outbox_requeued: Mapped[int] = mapped_column(Integer, nullable=False, name="deadOutboxRequeued")
    reindex_job_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="reindexJobId")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startedAt")
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="finishedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RefundRequest(Base):
    """tenant_template.RefundRequests"""

    __tablename__ = "RefundRequests"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    transaction_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="transactionId")
    requested_by_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="requestedByKind")
    requested_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="requestedByStaffUserId")
    reason: Mapped[str] = mapped_column(String(4000), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, name="amountMinor")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    decided_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="decidedByStaffUserId")
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="decidedAt")
    decision_note: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="decisionNote")
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="requestedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RegressionCaseResult(Base):
    """tenant_template.RegressionCaseResults"""

    __tablename__ = "RegressionCaseResults"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    regression_run_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="regressionRunId")
    golden_case_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="goldenCaseId")
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    accuracy_score: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="accuracyScore")
    groundedness_score: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="groundednessScore")
    tool_accuracy_score: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="toolAccuracyScore")
    actual_response: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="actualResponse")
    actual_tool_calls_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="actualToolCallsJson")
    failure_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="failureReason")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RegressionRun(Base):
    """tenant_template.RegressionRuns"""

    __tablename__ = "RegressionRuns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    golden_set_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="goldenSetId")
    agent_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentId")
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    triggered_by: Mapped[str] = mapped_column(String(4000), nullable=False, name="triggeredBy")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    accuracy: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True)
    groundedness: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True)
    tool_accuracy: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="toolAccuracy")
    locale_parity: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="localeParity")
    result: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    cases_total: Mapped[int] = mapped_column(Integer, nullable=False, name="casesTotal")
    cases_passed: Mapped[int] = mapped_column(Integer, nullable=False, name="casesPassed")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startedAt")
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="finishedAt")
    ran_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="ranByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ReindexJob(Base):
    """tenant_template.ReindexJobs"""

    __tablename__ = "ReindexJobs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    scope: Mapped[str] = mapped_column(String(4000), nullable=False)
    knowledge_source_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="knowledgeSourceId")
    knowledge_collection_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="knowledgeCollectionId")
    reason: Mapped[str] = mapped_column(String(4000), nullable=False)
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, name="progressPercent")
    chunks_total: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="chunksTotal")
    chunks_processed: Mapped[int] = mapped_column(Integer, nullable=False, name="chunksProcessed")
    target_embedding_model: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="targetEmbeddingModel")
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="startedAt")
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="finishedAt")
    error: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    ran_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="ranByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RetentionSweepRun(Base):
    """tenant_template.RetentionSweepRuns"""

    __tablename__ = "RetentionSweepRuns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    scope: Mapped[str] = mapped_column(String(4000), nullable=False)
    retention_setting: Mapped[str] = mapped_column(String(4000), nullable=False, name="retentionSetting")
    cutoff_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="cutoffAt")
    conversations_purged: Mapped[int] = mapped_column(Integer, nullable=False, name="conversationsPurged")
    turns_purged: Mapped[int] = mapped_column(Integer, nullable=False, name="turnsPurged")
    traces_purged: Mapped[int] = mapped_column(Integer, nullable=False, name="tracesPurged")
    derived_memory_purged: Mapped[int] = mapped_column(Integer, nullable=False, name="derivedMemoryPurged")
    vectors_purged: Mapped[int] = mapped_column(Integer, nullable=False, name="vectorsPurged")
    graph_nodes_purged: Mapped[int] = mapped_column(Integer, nullable=False, name="graphNodesPurged")
    redis_keys_purged: Mapped[int] = mapped_column(Integer, nullable=False, name="redisKeysPurged")
    transactions_skipped: Mapped[int] = mapped_column(Integer, nullable=False, name="transactionsSkipped")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="startedAt")
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="finishedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RetrievalConfig(Base):
    """tenant_template.RetrievalConfigs"""

    __tablename__ = "RetrievalConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    scope: Mapped[str] = mapped_column(String(4000), nullable=False)
    knowledge_collection_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="knowledgeCollectionId")
    chunk_size_tokens: Mapped[int] = mapped_column(Integer, nullable=False, name="chunkSizeTokens")
    chunk_overlap_tokens: Mapped[int] = mapped_column(Integer, nullable=False, name="chunkOverlapTokens")
    embedding_model: Mapped[str] = mapped_column(String(4000), nullable=False, name="embeddingModel")
    embedding_dimension: Mapped[int] = mapped_column(Integer, nullable=False, name="embeddingDimension")
    graph_weight: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="graphWeight")
    vector_weight: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="vectorWeight")
    top_k: Mapped[int] = mapped_column(Integer, nullable=False, name="topK")
    reranker_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="rerankerEnabled")
    reranker_model: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="rerankerModel")
    rerank_candidate_count: Mapped[int] = mapped_column(Integer, nullable=False, name="rerankCandidateCount")
    min_grounding_confidence: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="minGroundingConfidence")
    default_conflict_policy: Mapped[str] = mapped_column(String(4000), nullable=False, name="defaultConflictPolicy")
    max_graph_hops: Mapped[int] = mapped_column(Integer, nullable=False, name="maxGraphHops")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RetrievalPlaygroundRun(Base):
    """tenant_template.RetrievalPlaygroundRuns"""

    __tablename__ = "RetrievalPlaygroundRuns"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    query: Mapped[str] = mapped_column(String(4000), nullable=False)
    config_snapshot_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="configSnapshotJson")
    results_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="resultsJson")
    matched_subgraph: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="matchedSubgraph")
    top_score: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True, name="topScore")
    ran_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ranByStaffUserId")
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, name="durationMs")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Role(Base):
    """tenant_template.Roles"""

    __tablename__ = "Roles"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    key: Mapped[str] = mapped_column(String(4000), nullable=False)
    display_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="displayName")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isSystem")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RolePermission(Base):
    """tenant_template.RolePermissions"""

    __tablename__ = "RolePermissions"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    role_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="roleId")
    permission_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="permissionKey")
    granted_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="grantedByStaffUserId")
    granted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="grantedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RouterConfig(Base):
    """tenant_template.RouterConfigs"""

    __tablename__ = "RouterConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    execution_mode: Mapped[str] = mapped_column(String(4000), nullable=False, name="executionMode")
    routing_strategy: Mapped[str] = mapped_column(String(4000), nullable=False, name="routingStrategy")
    agent_selection_scope: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentSelectionScope")
    agent_scope_list_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="agentScopeListJson")
    max_hops: Mapped[int] = mapped_column(Integer, nullable=False, name="maxHops")
    max_loop_iterations: Mapped[int] = mapped_column(Integer, nullable=False, name="maxLoopIterations")
    cost_ceiling_tokens: Mapped[int] = mapped_column(Integer, nullable=False, name="costCeilingTokens")
    cost_ceiling_micro_aed: Mapped[int] = mapped_column(BigInteger, nullable=False, name="costCeilingMicroAed")
    conflict_resolution: Mapped[str] = mapped_column(String(4000), nullable=False, name="conflictResolution")
    response_merge_policy: Mapped[str] = mapped_column(String(4000), nullable=False, name="responseMergePolicy")
    fallback_agent_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fallbackAgentId")
    min_routing_confidence: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="minRoutingConfidence")
    active_pipeline_version_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="activePipelineVersionId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RoutingRule(Base):
    """tenant_template.RoutingRules"""

    __tablename__ = "RoutingRules"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    attribute: Mapped[str] = mapped_column(String(4000), nullable=False)
    operator: Mapped[str] = mapped_column(String(4000), nullable=False)
    value: Mapped[str] = mapped_column(String(4000), nullable=False)
    target_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetKind")
    target_team_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="targetTeamId")
    alert_supervisor: Mapped[bool] = mapped_column(Boolean, nullable=False, name="alertSupervisor")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    created_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="createdByStaffUserId")
    updated_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class RoutingRuleTest(Base):
    """tenant_template.RoutingRuleTests"""

    __tablename__ = "RoutingRuleTests"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    sample_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="sampleJson")
    fired_routing_rule_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="firedRoutingRuleId")
    fired_rule_ordinal: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="firedRuleOrdinal")
    resolved_target: Mapped[str] = mapped_column(String(4000), nullable=False, name="resolvedTarget")
    fell_to_default_queue: Mapped[bool] = mapped_column(Boolean, nullable=False, name="fellToDefaultQueue")
    rule_set_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="ruleSetHash")
    ran_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="ranByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class SecurityPolicy(Base):
    """tenant_template.SecurityPolicies"""

    __tablename__ = "SecurityPolicies"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    staff_session_idle_minutes: Mapped[int] = mapped_column(Integer, nullable=False, name="staffSessionIdleMinutes")
    staff_session_absolute_hours: Mapped[int] = mapped_column(Integer, nullable=False, name="staffSessionAbsoluteHours")
    lockout_failures_before_lock: Mapped[int] = mapped_column(Integer, nullable=False, name="lockoutFailuresBeforeLock")
    lockout_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, name="lockoutDurationMinutes")
    backoff_ceiling_seconds: Mapped[int] = mapped_column(Integer, nullable=False, name="backoffCeilingSeconds")
    updated_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ServiceHealthSample(Base):
    """tenant_template.ServiceHealthSamples"""

    __tablename__ = "ServiceHealthSamples"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    target_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetKind")
    target_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="targetId")
    target_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="targetKey")
    display_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="displayName")
    window_start: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="windowStart")
    window_end: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="windowEnd")
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, name="requestCount")
    p50_latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="p50LatencyMs")
    p95_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, name="p95LatencyMs")
    p99_latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="p99LatencyMs")
    error_rate: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="errorRate")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Skill(Base):
    """tenant_template.Skills"""

    __tablename__ = "Skills"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    key: Mapped[str] = mapped_column(String(4000), nullable=False)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    invocation_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="invocationKind")
    api_connector_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="apiConnectorId")
    mcp_tool_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="mcpToolId")
    input_schema_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="inputSchemaJson")
    output_schema_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="outputSchemaJson")
    rate_limit_policy_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="rateLimitPolicyId")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isSystem")
    is_attached_by_default: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isAttachedByDefault")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Skin(Base):
    """tenant_template.Skins"""

    __tablename__ = "Skins"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    light_token_set_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="lightTokenSetId")
    dark_token_set_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="darkTokenSetId")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isSystem")
    is_tenant_default: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isTenantDefault")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    duplicated_from_skin_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="duplicatedFromSkinId")
    export_schema_version: Mapped[int] = mapped_column(Integer, nullable=False, name="exportSchemaVersion")
    created_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="createdByStaffUserId")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class SourceConflict(Base):
    """tenant_template.SourceConflicts"""

    __tablename__ = "SourceConflicts"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    topic: Mapped[str] = mapped_column(String(4000), nullable=False)
    graph_node_record_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="graphNodeRecordId")
    graph_entity_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="graphEntityKey")
    side_a_chunk_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="sideAChunkId")
    side_a_knowledge_source_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="sideAKnowledgeSourceId")
    side_a_value: Mapped[str] = mapped_column(String(4000), nullable=False, name="sideAValue")
    side_a_source_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="sideASourceUpdatedAt")
    side_b_chunk_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="sideBChunkId")
    side_b_knowledge_source_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="sideBKnowledgeSourceId")
    side_b_value: Mapped[str] = mapped_column(String(4000), nullable=False, name="sideBValue")
    side_b_source_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="sideBSourceUpdatedAt")
    detected_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="detectedAt")
    detection_method: Mapped[str] = mapped_column(String(4000), nullable=False, name="detectionMethod")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    policy_at_detection: Mapped[str] = mapped_column(String(4000), nullable=False, name="policyAtDetection")
    authoritative_side: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="authoritativeSide")
    resolved_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="resolvedByStaffUserId")
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="resolvedAt")
    grounding_penalty: Mapped[Decimal] = mapped_column(Numeric, nullable=False, name="groundingPenalty")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class SourceDocument(Base):
    """tenant_template.SourceDocuments"""

    __tablename__ = "SourceDocuments"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    knowledge_source_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="knowledgeSourceId")
    external_ref: Mapped[str] = mapped_column(String(4000), nullable=False, name="externalRef")
    title: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="contentHash")
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False, name="byteSize")
    mime_type: Mapped[str] = mapped_column(String(4000), nullable=False, name="mimeType")
    locale_code: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="localeCode")
    storage_ref: Mapped[str] = mapped_column(String(4000), nullable=False, name="storageRef")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="fetchedAt")
    superseded_by_document_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="supersededByDocumentId")
    superseded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="supersededAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class StaffCredential(Base):
    """platform.StaffCredentials"""

    __tablename__ = "StaffCredentials"
    __table_args__ = {"schema": "platform"}

    staff_user_id: Mapped[str] = mapped_column(String(4000), primary_key=True, name="staffUserId")
    password_hash: Mapped[str] = mapped_column(String(4000), nullable=False, name="passwordHash")
    password_algorithm: Mapped[str] = mapped_column(String(4000), nullable=False, name="passwordAlgorithm")
    password_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="passwordUpdatedAt")
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, name="mustChangePassword")
    totp_secret_cipher: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True, name="totpSecretCipher")
    totp_enrolled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="totpEnrolledAt")
    failed_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, name="failedAttemptCount")
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lockedUntil")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class StaffUser(Base):
    """platform.StaffUsers"""

    __tablename__ = "StaffUsers"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    email: Mapped[str] = mapped_column(String(4000), nullable=False)
    display_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="displayName")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    home_tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="homeTenantId")
    invited_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="invitedByStaffUserId")
    invited_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="invitedAt")
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="acceptedAt")
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lastLoginAt")
    session_epoch: Mapped[int] = mapped_column(Integer, nullable=False, name="sessionEpoch")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class StepUpRule(Base):
    """tenant_template.StepUpRules"""

    __tablename__ = "StepUpRules"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    action_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="actionKey")
    required_assurance: Mapped[str] = mapped_column(String(4000), nullable=False, name="requiredAssurance")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Team(Base):
    """tenant_template.Teams"""

    __tablename__ = "Teams"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    scope: Mapped[str] = mapped_column(String(4000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isSystem")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TeamMember(Base):
    """tenant_template.TeamMembers"""

    __tablename__ = "TeamMembers"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    team_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="teamId")
    staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="staffUserId")
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isPrimary")
    added_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="addedByStaffUserId")
    added_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="addedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Tenant(Base):
    """platform.Tenants"""

    __tablename__ = "Tenants"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    slug: Mapped[str] = mapped_column(String(4000), nullable=False)
    display_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="displayName")
    entity_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="entityKind")
    sql_schema: Mapped[str] = mapped_column(String(4000), nullable=False, name="sqlSchema")
    neo4j_tenant_label: Mapped[str] = mapped_column(String(4000), nullable=False, name="neo4jTenantLabel")
    qdrant_collection: Mapped[str] = mapped_column(String(4000), nullable=False, name="qdrantCollection")
    redis_prefix: Mapped[str] = mapped_column(String(4000), nullable=False, name="redisPrefix")
    data_residency: Mapped[str] = mapped_column(String(4000), nullable=False, name="dataResidency")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    activated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="activatedAt")
    suspended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="suspendedAt")
    deprovisioned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deprovisionedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TenantBranding(Base):
    """tenant_template.TenantBrandings"""

    __tablename__ = "TenantBrandings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    active_skin_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="activeSkinId")
    app_title: Mapped[str] = mapped_column(String(4000), nullable=False, name="appTitle")
    logo_light_asset_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="logoLightAssetId")
    logo_dark_asset_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="logoDarkAssetId")
    favicon_asset_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="faviconAssetId")
    default_mode: Mapped[str] = mapped_column(String(4000), nullable=False, name="defaultMode")
    default_direction: Mapped[str] = mapped_column(String(4000), nullable=False, name="defaultDirection")
    density: Mapped[str] = mapped_column(String(4000), nullable=False)
    font_size: Mapped[str] = mapped_column(String(4000), nullable=False, name="fontSize")
    shadow_depth: Mapped[str] = mapped_column(String(4000), nullable=False, name="shadowDepth")
    sidebar_style: Mapped[str] = mapped_column(String(4000), nullable=False, name="sidebarStyle")
    white_label_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="whiteLabelEnabled")
    updated_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TenantMembership(Base):
    """platform.TenantMemberships"""

    __tablename__ = "TenantMemberships"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="staffUserId")
    tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="tenantId")
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isPrimary")
    granted_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="grantedByStaffUserId")
    granted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="grantedAt")
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="revokedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TenantMigration(Base):
    """platform.TenantMigrations"""

    __tablename__ = "TenantMigrations"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="tenantId")
    migration_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="migrationName")
    checksum: Mapped[str] = mapped_column(String(4000), nullable=False)
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    migration_run_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="migrationRunId")
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="appliedAt")
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, name="durationMs")
    error: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TenantProfile(Base):
    """tenant_template.TenantProfiles"""

    __tablename__ = "TenantProfiles"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="tenantId")
    slug: Mapped[str] = mapped_column(String(4000), nullable=False)
    display_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="displayName")
    is_platform_tenant: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isPlatformTenant")
    data_residency: Mapped[str] = mapped_column(String(4000), nullable=False, name="dataResidency")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TenantProvisioningStep(Base):
    """platform.TenantProvisioningSteps"""

    __tablename__ = "TenantProvisioningSteps"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="tenantId")
    store: Mapped[str] = mapped_column(String(4000), nullable=False)
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, name="attemptCount")
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="startedAt")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="completedAt")
    rolled_back_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="rolledBackAt")
    last_error: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="lastError")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TokenSet(Base):
    """tenant_template.TokenSets"""

    __tablename__ = "TokenSets"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    kind: Mapped[str] = mapped_column(String(4000), nullable=False)
    mode: Mapped[str] = mapped_column(String(4000), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, name="schemaVersion")
    tokens_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="tokensJson")
    parent_token_set_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="parentTokenSetId")
    contrast_validated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="contrastValidatedAt")
    contrast_report_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="contrastReportJson")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="deletedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class ToolBinding(Base):
    """tenant_template.ToolBindings"""

    __tablename__ = "ToolBindings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    target_kind: Mapped[str] = mapped_column(String(4000), nullable=False, name="targetKind")
    skill_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="skillId")
    mcp_tool_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="mcpToolId")
    api_connector_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="apiConnectorId")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    argument_policy_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="argumentPolicyJson")
    required_assurance: Mapped[str] = mapped_column(String(4000), nullable=False, name="requiredAssurance")
    rate_limit_policy_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="rateLimitPolicyId")
    bound_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="boundByStaffUserId")
    bound_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="boundAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class Transaction(Base):
    """tenant_template.Transactions"""

    __tablename__ = "Transactions"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    reference: Mapped[str] = mapped_column(String(4000), nullable=False)
    conversation_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="conversationId")
    citizen_identity_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="citizenIdentityId")
    payment_gateway_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="paymentGatewayId")
    service_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="serviceKey")
    service_label: Mapped[str] = mapped_column(String(4000), nullable=False, name="serviceLabel")
    linked_service_account_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="linkedServiceAccountId")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, name="amountMinor")
    currency: Mapped[str] = mapped_column(String(4000), nullable=False)
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    gateway_reference: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="gatewayReference")
    idempotency_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="idempotencyKey")
    assurance_level_at_payment: Mapped[str] = mapped_column(String(4000), nullable=False, name="assuranceLevelAtPayment")
    initiated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="initiatedAt")
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="settledAt")
    failure_code: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="failureCode")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TranscriptExport(Base):
    """tenant_template.TranscriptExports"""

    __tablename__ = "TranscriptExports"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    requested_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="requestedByStaffUserId")
    filter_json: Mapped[str] = mapped_column(String(4000), nullable=False, name="filterJson")
    exported_row_count: Mapped[int] = mapped_column(Integer, nullable=False, name="exportedRowCount")
    format: Mapped[str] = mapped_column(String(4000), nullable=False)
    redaction_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, name="redactionApplied")
    storage_ref: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="storageRef")
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="expiresAt")
    downloaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="downloadedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class TranslationString(Base):
    """tenant_template.TranslationStrings"""

    __tablename__ = "TranslationStrings"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    string_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="stringKey")
    locale_code: Mapped[str] = mapped_column(String(4000), nullable=False, name="localeCode")
    value: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    updated_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="updatedByStaffUserId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class UnansweredQuestion(Base):
    """tenant_template.UnansweredQuestions"""

    __tablename__ = "UnansweredQuestions"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    question_text: Mapped[str] = mapped_column(String(4000), nullable=False, name="questionText")
    cluster_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="clusterKey")
    ask_count: Mapped[int] = mapped_column(Integer, nullable=False, name="askCount")
    first_asked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="firstAskedAt")
    last_asked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="lastAskedAt")
    status: Mapped[str] = mapped_column(String(4000), nullable=False)
    resolution_knowledge_source_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="resolutionKnowledgeSourceId")
    resolution_flow_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="resolutionFlowId")
    resolved_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="resolvedByStaffUserId")
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="resolvedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class UserRoleAssignment(Base):
    """tenant_template.UserRoleAssignments"""

    __tablename__ = "UserRoleAssignments"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="staffUserId")
    role_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="roleId")
    scope_team_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="scopeTeamId")
    assigned_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="assignedByStaffUserId")
    assigned_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="assignedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class UserThemePreference(Base):
    """tenant_template.UserThemePreferences"""

    __tablename__ = "UserThemePreferences"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="staffUserId")
    skin_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="skinId")
    mode: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    density: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    direction: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    font_size: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="fontSize")
    reduced_motion: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, name="reducedMotion")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class VectorCollectionRegistryEntry(Base):
    """platform.VectorCollectionRegistry"""

    __tablename__ = "VectorCollectionRegistry"
    __table_args__ = {"schema": "platform"}

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="tenantId")
    collection_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="collectionName")
    alias_name: Mapped[str] = mapped_column(String(4000), nullable=False, name="aliasName")
    embedding_model: Mapped[str] = mapped_column(String(4000), nullable=False, name="embeddingModel")
    embedding_dimension: Mapped[int] = mapped_column(Integer, nullable=False, name="embeddingDimension")
    distance: Mapped[str] = mapped_column(String(4000), nullable=False)
    point_count: Mapped[int] = mapped_column(BigInteger, nullable=False, name="pointCount")
    last_full_reindex_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="lastFullReindexAt")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class VerificationAttempt(Base):
    """tenant_template.VerificationAttempts"""

    __tablename__ = "VerificationAttempts"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    conversation_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="conversationId")
    citizen_identity_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="citizenIdentityId")
    provider_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="providerKey")
    action_key: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="actionKey")
    required_assurance: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="requiredAssurance")
    result: Mapped[str] = mapped_column(String(4000), nullable=False)
    failure_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="failureReason")
    attempted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="attemptedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class VerificationConfig(Base):
    """tenant_template.VerificationConfigs"""

    __tablename__ = "VerificationConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    singleton_key: Mapped[int] = mapped_column(Integer, nullable=False, name="singletonKey")
    account_ownership_check_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="accountOwnershipCheckEnabled")
    ownership_check_disabled_reason: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="ownershipCheckDisabledReason")
    ownership_check_last_changed_by_staff_user_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="ownershipCheckLastChangedByStaffUserId")
    ownership_check_last_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="ownershipCheckLastChangedAt")
    otp_length_digits: Mapped[int] = mapped_column(Integer, nullable=False, name="otpLengthDigits")
    otp_ttl_seconds: Mapped[int] = mapped_column(Integer, nullable=False, name="otpTtlSeconds")
    otp_max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, name="otpMaxAttempts")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class VerificationProvider(Base):
    """tenant_template.VerificationProviders"""

    __tablename__ = "VerificationProviders"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    key: Mapped[str] = mapped_column(String(4000), nullable=False)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(4000), nullable=False, name="providerType")
    note: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, name="isEnabled")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    config_json: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="configJson")
    credential_secret_ref: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="credentialSecretRef")
    provides_assurance: Mapped[str] = mapped_column(String(4000), nullable=False, name="providesAssurance")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class VersionDeployment(Base):
    """tenant_template.VersionDeployments"""

    __tablename__ = "VersionDeployments"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentId")
    agent_version_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="agentVersionId")
    environment_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="environmentKey")
    state: Mapped[str] = mapped_column(String(4000), nullable=False)
    deployed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="deployedAt")
    deployed_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="deployedByStaffUserId")
    superseded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, name="supersededAt")
    promotion_request_id: Mapped[Optional[str]] = mapped_column(String(4000), nullable=True, name="promotionRequestId")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class WhatsAppConfig(Base):
    """tenant_template.WhatsAppConfigs"""

    __tablename__ = "WhatsAppConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    channel_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelId")
    phone_number: Mapped[str] = mapped_column(String(4000), nullable=False, name="phoneNumber")
    phone_number_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="phoneNumberId")
    waba_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="wabaId")
    bsp_provider: Mapped[str] = mapped_column(String(4000), nullable=False, name="bspProvider")
    opt_in_required: Mapped[bool] = mapped_column(Boolean, nullable=False, name="optInRequired")
    session_window_hours: Mapped[int] = mapped_column(Integer, nullable=False, name="sessionWindowHours")
    credential_secret_ref: Mapped[str] = mapped_column(String(4000), nullable=False, name="credentialSecretRef")
    webhook_verify_secret_ref: Mapped[str] = mapped_column(String(4000), nullable=False, name="webhookVerifySecretRef")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class WidgetAllowedDomain(Base):
    """tenant_template.WidgetAllowedDomains"""

    __tablename__ = "WidgetAllowedDomains"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    channel_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelId")
    domain: Mapped[str] = mapped_column(String(4000), nullable=False)
    added_by_staff_user_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="addedByStaffUserId")
    added_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="addedAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class WidgetConfig(Base):
    """tenant_template.WidgetConfigs"""

    __tablename__ = "WidgetConfigs"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    channel_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="channelId")
    accent_token_key: Mapped[str] = mapped_column(String(4000), nullable=False, name="accentTokenKey")
    launcher_position: Mapped[str] = mapped_column(String(4000), nullable=False, name="launcherPosition")
    default_state: Mapped[str] = mapped_column(String(4000), nullable=False, name="defaultState")
    disclaimer_text: Mapped[str] = mapped_column(String(4000), nullable=False, name="disclaimerText")
    greeting_text: Mapped[str] = mapped_column(String(4000), nullable=False, name="greetingText")
    composer_placeholder: Mapped[str] = mapped_column(String(4000), nullable=False, name="composerPlaceholder")
    show_disclaimer_dismiss: Mapped[bool] = mapped_column(Boolean, nullable=False, name="showDisclaimerDismiss")
    embed_snippet_version: Mapped[int] = mapped_column(Integer, nullable=False, name="embedSnippetVersion")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class WorkingHoursProfile(Base):
    """tenant_template.WorkingHoursProfiles"""

    __tablename__ = "WorkingHoursProfiles"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    name: Mapped[str] = mapped_column(String(4000), nullable=False)
    timezone: Mapped[str] = mapped_column(String(4000), nullable=False)
    public_holiday_auto_sync: Mapped[bool] = mapped_column(Boolean, nullable=False, name="publicHolidayAutoSync")
    assistant_available247: Mapped[bool] = mapped_column(Boolean, nullable=False, name="assistantAvailable247")
    no_agent_available_message: Mapped[str] = mapped_column(String(4000), nullable=False, name="noAgentAvailableMessage")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


class WorkingHoursSlot(Base):
    """tenant_template.WorkingHoursSlots"""

    __tablename__ = "WorkingHoursSlots"
    # Schema bound per tenant at session creation (ADR-0002); not fixed here.

    id: Mapped[str] = mapped_column(String(4000), primary_key=True)
    working_hours_profile_id: Mapped[str] = mapped_column(String(4000), nullable=False, name="workingHoursProfileId")
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False, name="dayOfWeek")
    opens_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="opensAt")
    closes_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="closesAt")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="createdAt")
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, name="updatedAt")


__all__ = [
    "Base",
    "Agent",
    "AgentChannelBinding",
    "AgentFlowBinding",
    "AgentKnowledgeBinding",
    "AgentLocaleBinding",
    "AgentPresence",
    "AgentSandboxRun",
    "AgentUsageDaily",
    "AgentVersion",
    "AgentVersionHistoryEntry",
    "AgentWizardDraft",
    "ApiConnector",
    "AuditLogEntry",
    "BrandAsset",
    "Campaign",
    "CampaignSend",
    "CannedReply",
    "Channel",
    "Chunk",
    "CircuitBreakerConfig",
    "CircuitBreakerEvent",
    "CitizenIdentity",
    "ConsentLedgerEntry",
    "ConsentState",
    "Conversation",
    "ConversationMetricsDaily",
    "ConversationSlot",
    "ConversationTurn",
    "Environment",
    "ErasureRequest",
    "ErasureTask",
    "EscalationTicket",
    "FeedbackIssue",
    "Flow",
    "FlowAssistantConfig",
    "FlowEdge",
    "FlowNode",
    "FlowVersion",
    "GateEvaluation",
    "GoldenCase",
    "GoldenSet",
    "GraphDuplicateCandidate",
    "GraphEdgeRecord",
    "GraphMergeDecision",
    "GraphNodeRecord",
    "GroundingCitation",
    "GuideAsset",
    "GuideCoverageCheck",
    "GuideEntry",
    "GuideEntryTranslation",
    "GuideScreenshot",
    "GuideSection",
    "HandoverConfig",
    "IdentityLink",
    "IdentityStitchingConfig",
    "IngestionRun",
    "IntentMetricsDaily",
    "KnowledgeCollection",
    "KnowledgeSource",
    "LinkedServiceAccount",
    "Locale",
    "LocaleSetting",
    "McpServer",
    "McpTool",
    "MessageFeedback",
    "MessageTemplate",
    "MigrationRun",
    "OrchestrationTrace",
    "OrchestrationTraceStep",
    "OutboxEvent",
    "OverridablePolicy",
    "PaymentEvent",
    "PaymentGateway",
    "Permission",
    "PipelineDesign",
    "PipelineEdge",
    "PipelineNode",
    "PipelineVersion",
    "PipelineVersionHistoryEntry",
    "PlatformAuditLogEntry",
    "PlatformErasureRequest",
    "PlatformSkin",
    "PlatformTokenSet",
    "Policy",
    "PolicyOverride",
    "PolicySetting",
    "PrivacyConfig",
    "PromotionRequest",
    "PublicHoliday",
    "PublishGate",
    "QuickAction",
    "QuietHoursConfig",
    "RateLimitPolicy",
    "ReceiptConfig",
    "ReconciliationRun",
    "RefundRequest",
    "RegressionCaseResult",
    "RegressionRun",
    "ReindexJob",
    "RetentionSweepRun",
    "RetrievalConfig",
    "RetrievalPlaygroundRun",
    "Role",
    "RolePermission",
    "RouterConfig",
    "RoutingRule",
    "RoutingRuleTest",
    "SecurityPolicy",
    "ServiceHealthSample",
    "Skill",
    "Skin",
    "SourceConflict",
    "SourceDocument",
    "StaffCredential",
    "StaffUser",
    "StepUpRule",
    "Team",
    "TeamMember",
    "Tenant",
    "TenantBranding",
    "TenantMembership",
    "TenantMigration",
    "TenantProfile",
    "TenantProvisioningStep",
    "TokenSet",
    "ToolBinding",
    "Transaction",
    "TranscriptExport",
    "TranslationString",
    "UnansweredQuestion",
    "UserRoleAssignment",
    "UserThemePreference",
    "VectorCollectionRegistryEntry",
    "VerificationAttempt",
    "VerificationConfig",
    "VerificationProvider",
    "VersionDeployment",
    "WhatsAppConfig",
    "WidgetAllowedDomain",
    "WidgetConfig",
    "WorkingHoursProfile",
    "WorkingHoursSlot",
]
