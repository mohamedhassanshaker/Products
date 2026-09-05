-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "ConfigStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "ProviderCategory" AS ENUM ('transport', 'stt', 'llm', 'tts', 'avatar');

-- CreateEnum
CREATE TYPE "ProviderHosting" AS ENUM ('self_hosted', 'remote');

-- CreateEnum
CREATE TYPE "ProbeStatus" AS ENUM ('healthy', 'degraded', 'unreachable', 'unknown');

-- CreateEnum
CREATE TYPE "ResidencyMode" AS ENUM ('prompt_text_only', 'prompt_and_transcript', 'none');

-- CreateEnum
CREATE TYPE "AgentRuntime" AS ENUM ('langgraph', 'pydantic-ai');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('pending', 'active', 'ended', 'failed', 'abandoned', 'degraded');

-- CreateEnum
CREATE TYPE "UtteranceRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "HopKind" AS ENUM ('stt', 'llm', 'tts', 'avatar', 'e2e');

-- CreateEnum
CREATE TYPE "GpuRole" AS ENUM ('stt', 'tts', 'avatar');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('llm_failover', 'provider_unreachable', 'session_failed', 'gpu_unhealthy');

-- CreateEnum
CREATE TYPE "SummaryStatus" AS ENUM ('none', 'pending', 'ready', 'unavailable');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "room_namespace" VARCHAR(48) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "roles" TEXT[],
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user_tenant" (
    "admin_user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_tenant_pkey" PRIMARY KEY ("admin_user_id","tenant_id")
);

-- CreateTable
CREATE TABLE "admin_invite" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "roles" TEXT[],
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_invite_tenant" (
    "invite_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "admin_invite_tenant_pkey" PRIMARY KEY ("invite_id","tenant_id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_definition" (
    "key" VARCHAR(64) NOT NULL,
    "category" "ProviderCategory" NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "hosting" "ProviderHosting" NOT NULL,
    "interface_name" VARCHAR(48) NOT NULL,
    "requires_credential" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "feature_gaps" TEXT,

    CONSTRAINT "provider_definition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "provider_credential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider_key" VARCHAR(64) NOT NULL,
    "display_label" VARCHAR(80) NOT NULL DEFAULT 'default',
    "endpoint_url" VARCHAR(2048) NOT NULL,
    "credential_ref" VARCHAR(256),
    "extra" JSONB NOT NULL DEFAULT '{}',
    "last_probe_status" "ProbeStatus" NOT NULL DEFAULT 'unknown',
    "last_probe_at" TIMESTAMPTZ,
    "last_probe_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "provider_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "yaml_text" TEXT NOT NULL,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "transport_provider" VARCHAR(64),
    "stt_provider" VARCHAR(64),
    "llm_provider" VARCHAR(64),
    "llm_fallback_provider" VARCHAR(64),
    "tts_provider" VARCHAR(64),
    "avatar_provider" VARCHAR(64),
    "agent_runtime" "AgentRuntime",
    "published_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "deployment_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_residency_policy" (
    "tenant_id" UUID NOT NULL,
    "send_to_remote_llm" "ResidencyMode" NOT NULL DEFAULT 'prompt_text_only',
    "retain_transcripts_days" INTEGER NOT NULL DEFAULT 90,
    "recordings_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "data_residency_policy_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "alert_policy" (
    "tenant_id" UUID NOT NULL,
    "retry_max_attempts" INTEGER NOT NULL DEFAULT 3,
    "retry_backoff_ms" INTEGER[] DEFAULT ARRAY[200, 400, 800]::INTEGER[],
    "degraded_mode_message" VARCHAR(500) NOT NULL DEFAULT 'I''m having trouble reaching the language service. Please wait a moment and try again.',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "alert_policy_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tool_definition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "api_ref" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "method" VARCHAR(8) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "credential_ref" VARCHAR(256),
    "args_schema" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tool_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "room_name" VARCHAR(128) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'pending',
    "error_code" VARCHAR(64),
    "provider_stack" JSONB NOT NULL,
    "residency_snapshot" JSONB NOT NULL,
    "display_name" VARCHAR(40),
    "tab_key" VARCHAR(128),
    "max_duration_seconds" INTEGER NOT NULL DEFAULT 7200,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "summary_token_hash" TEXT,
    "summary_token_expires_at" TIMESTAMPTZ,
    "summary_text" VARCHAR(500),
    "summary_status" "SummaryStatus" NOT NULL DEFAULT 'none',
    "transcript_purged" BOOLEAN NOT NULL DEFAULT false,
    "recording_present" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_utterance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" "UtteranceRole" NOT NULL,
    "text" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "transcript_utterance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "latency_hop" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "utterance_seq" INTEGER NOT NULL,
    "hop" "HopKind" NOT NULL,
    "first_partial_ms" INTEGER,
    "first_token_ms" INTEGER,
    "first_audio_ms" INTEGER,
    "first_frame_ms" INTEGER,
    "total_ms" INTEGER,
    "provider_key" VARCHAR(64),
    "used_fallback" BOOLEAN NOT NULL DEFAULT false,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "latency_hop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gpu_node_heartbeat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "hostname" VARCHAR(128) NOT NULL,
    "role" "GpuRole" NOT NULL,
    "gpu_util_pct" DECIMAL(5,2) NOT NULL,
    "mem_util_pct" DECIMAL(5,2) NOT NULL,
    "healthy" BOOLEAN NOT NULL,
    "autoscaler_note" VARCHAR(64) NOT NULL DEFAULT 'not_configured',
    "reported_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gpu_node_heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" "AlertType" NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_admin_user_id" UUID,
    "tenant_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(128) NOT NULL,
    "actor_id" UUID,
    "tenant_id" UUID,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "tenant_status_idx" ON "tenant"("status");

-- CreateIndex
CREATE INDEX "tenant_updated_at_idx" ON "tenant"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_email_key" ON "admin_user"("email");

-- CreateIndex
CREATE INDEX "admin_user_disabled_idx" ON "admin_user"("disabled");

-- CreateIndex
CREATE INDEX "admin_user_tenant_tenant_id_idx" ON "admin_user_tenant"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_invite_token_hash_key" ON "admin_invite"("token_hash");

-- CreateIndex
CREATE INDEX "admin_invite_email_idx" ON "admin_invite"("email");

-- CreateIndex
CREATE INDEX "admin_invite_expires_at_idx" ON "admin_invite"("expires_at");

-- CreateIndex
CREATE INDEX "admin_invite_tenant_tenant_id_idx" ON "admin_invite_tenant"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_admin_user_id_idx" ON "refresh_token"("admin_user_id");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE INDEX "refresh_token_expires_at_idx" ON "refresh_token"("expires_at");

-- CreateIndex
CREATE INDEX "provider_definition_category_enabled_idx" ON "provider_definition"("category", "enabled");

-- CreateIndex
CREATE INDEX "provider_credential_tenant_id_provider_key_idx" ON "provider_credential"("tenant_id", "provider_key");

-- CreateIndex
CREATE INDEX "provider_credential_last_probe_status_last_probe_at_idx" ON "provider_credential"("last_probe_status", "last_probe_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_credential_tenant_id_provider_key_display_label_key" ON "provider_credential"("tenant_id", "provider_key", "display_label");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_config_tenant_id_key" ON "deployment_config"("tenant_id");

-- CreateIndex
CREATE INDEX "deployment_config_status_idx" ON "deployment_config"("status");

-- CreateIndex
CREATE INDEX "tool_definition_tenant_id_enabled_idx" ON "tool_definition"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tool_definition_tenant_id_api_ref_key" ON "tool_definition"("tenant_id", "api_ref");

-- CreateIndex
CREATE UNIQUE INDEX "session_room_name_key" ON "session"("room_name");

-- CreateIndex
CREATE UNIQUE INDEX "session_summary_token_hash_key" ON "session"("summary_token_hash");

-- CreateIndex
CREATE INDEX "session_tenant_id_started_at_idx" ON "session"("tenant_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "session_tenant_id_status_idx" ON "session"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "session_status_started_at_idx" ON "session"("status", "started_at");

-- CreateIndex
CREATE INDEX "session_tenant_id_tab_key_idx" ON "session"("tenant_id", "tab_key");

-- CreateIndex
CREATE INDEX "transcript_utterance_tenant_id_session_id_seq_idx" ON "transcript_utterance"("tenant_id", "session_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_utterance_session_id_seq_key" ON "transcript_utterance"("session_id", "seq");

-- CreateIndex
CREATE INDEX "latency_hop_session_id_utterance_seq_idx" ON "latency_hop"("session_id", "utterance_seq");

-- CreateIndex
CREATE INDEX "latency_hop_tenant_id_hop_created_at_idx" ON "latency_hop"("tenant_id", "hop", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "latency_hop_session_id_utterance_seq_hop_key" ON "latency_hop"("session_id", "utterance_seq", "hop");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_session_id_key" ON "feedback"("session_id");

-- CreateIndex
CREATE INDEX "feedback_tenant_id_created_at_idx" ON "feedback"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "gpu_node_heartbeat_hostname_reported_at_idx" ON "gpu_node_heartbeat"("hostname", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "gpu_node_heartbeat_role_reported_at_idx" ON "gpu_node_heartbeat"("role", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "gpu_node_heartbeat_tenant_id_idx" ON "gpu_node_heartbeat"("tenant_id");

-- CreateIndex
CREATE INDEX "alert_event_tenant_id_created_at_idx" ON "alert_event"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alert_event_type_created_at_idx" ON "alert_event"("type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_admin_user_id_created_at_idx" ON "audit_log"("actor_admin_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "idempotency_record_created_at_idx" ON "idempotency_record"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_scope_key_actor_id_key" ON "idempotency_record"("scope", "key", "actor_id");

-- AddForeignKey
ALTER TABLE "admin_user_tenant" ADD CONSTRAINT "admin_user_tenant_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_tenant" ADD CONSTRAINT "admin_user_tenant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invite" ADD CONSTRAINT "admin_invite_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invite_tenant" ADD CONSTRAINT "admin_invite_tenant_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "admin_invite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invite_tenant" ADD CONSTRAINT "admin_invite_tenant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_credential" ADD CONSTRAINT "provider_credential_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_credential" ADD CONSTRAINT "provider_credential_provider_key_fkey" FOREIGN KEY ("provider_key") REFERENCES "provider_definition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_config" ADD CONSTRAINT "deployment_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_residency_policy" ADD CONSTRAINT "data_residency_policy_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_policy" ADD CONSTRAINT "alert_policy_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_definition" ADD CONSTRAINT "tool_definition_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_utterance" ADD CONSTRAINT "transcript_utterance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "latency_hop" ADD CONSTRAINT "latency_hop_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
