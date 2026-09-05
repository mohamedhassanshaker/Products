-- CreateEnum
CREATE TYPE "HitlGateType" AS ENUM ('blocking', 'deferred', 'pre_speech', 'whisper', 'post_hoc');

-- CreateEnum
CREATE TYPE "HitlAttachmentKind" AS ENUM ('tool', 'skill', 'graph_node');

-- CreateEnum
CREATE TYPE "HitlTimeoutBehavior" AS ENUM ('auto_approve', 'auto_deny', 'escalate', 'defer_to_async');

-- CreateEnum
CREATE TYPE "HitlGateStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "HitlDecisionStatus" AS ENUM ('pending', 'approved', 'denied', 'edited_approved', 'timed_out', 'escalated', 'deferred');

-- Pre-existing Prisma/schema drift note: `prisma migrate dev`'s diff also
-- proposed dropping `knowledge_chunk_embedding_hnsw_idx` /
-- `knowledge_chunk_search_vector_idx` and clearing `search_vector`'s
-- generated-column default — a known false-positive caused by
-- `Unsupported("tsvector")` not round-tripping the GENERATED ALWAYS AS
-- expression those indexes depend on (added as raw SQL in the
-- `knowledge_rag` migration, Phase 12a). Deliberately excluded from this
-- migration: unrelated to Phase 14, and applying it would silently break
-- knowledge retrieval's full-text search path.

-- AlterTable
ALTER TABLE "skill_version" ADD COLUMN     "hitl_gate_id" UUID;

-- AlterTable
ALTER TABLE "tool_definition" ADD COLUMN     "autonomous_use_ack_text" VARCHAR(1000);

-- CreateTable
CREATE TABLE "reviewer_group" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "members" TEXT[],
    "notification_channels" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reviewer_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hitl_gate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "attachment_kind" "HitlAttachmentKind" NOT NULL,
    "attachment_ref" VARCHAR(128) NOT NULL,
    "trigger_condition" JSONB NOT NULL DEFAULT '{}',
    "gate_type" "HitlGateType" NOT NULL,
    "reviewer_group_id" UUID NOT NULL,
    "sla_seconds" INTEGER NOT NULL,
    "hold_treatment_text" VARCHAR(500) NOT NULL,
    "timeout_behavior" "HitlTimeoutBehavior" NOT NULL,
    "escalate_to_group_id" UUID,
    "auto_approve_ack_text" VARCHAR(1000),
    "notify_channels" TEXT[],
    "environments" TEXT[] DEFAULT ARRAY['dev', 'staging', 'production']::TEXT[],
    "status" "HitlGateStatus" NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hitl_gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hitl_decision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "utterance_seq" INTEGER NOT NULL,
    "proposed_action" JSONB NOT NULL,
    "reviewer_id" UUID,
    "decision" "HitlDecisionStatus" NOT NULL DEFAULT 'pending',
    "edited_arguments" JSONB,
    "justification_note" VARCHAR(1000),
    "decided_at" TIMESTAMPTZ,
    "latency_ms" INTEGER,
    "outcome_notified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hitl_decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviewer_group_tenant_id_idx" ON "reviewer_group"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviewer_group_tenant_id_name_key" ON "reviewer_group"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "hitl_gate_tenant_id_status_idx" ON "hitl_gate"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "hitl_gate_tenant_id_attachment_kind_attachment_ref_idx" ON "hitl_gate"("tenant_id", "attachment_kind", "attachment_ref");

-- CreateIndex
CREATE INDEX "hitl_decision_tenant_id_decision_idx" ON "hitl_decision"("tenant_id", "decision");

-- CreateIndex
CREATE INDEX "hitl_decision_gate_id_idx" ON "hitl_decision"("gate_id");

-- CreateIndex
CREATE INDEX "hitl_decision_session_id_utterance_seq_idx" ON "hitl_decision"("session_id", "utterance_seq");

-- AddForeignKey
ALTER TABLE "reviewer_group" ADD CONSTRAINT "reviewer_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_gate" ADD CONSTRAINT "hitl_gate_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_gate" ADD CONSTRAINT "hitl_gate_reviewer_group_id_fkey" FOREIGN KEY ("reviewer_group_id") REFERENCES "reviewer_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_decision" ADD CONSTRAINT "hitl_decision_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_decision" ADD CONSTRAINT "hitl_decision_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "hitl_gate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
