-- CreateEnum
CREATE TYPE "ConfigVersionStatus" AS ENUM ('published', 'superseded', 'rolled_back');

-- AlterEnum
ALTER TYPE "HopKind" ADD VALUE 'node';

-- DropIndex
DROP INDEX "latency_hop_session_id_utterance_seq_hop_key";

-- AlterTable
ALTER TABLE "deployment_config" ADD COLUMN     "pending_rollback_from_version_id" UUID;

-- AlterTable
ALTER TABLE "latency_hop" ADD COLUMN     "lane" VARCHAR(16),
ADD COLUMN     "node_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "node_type" VARCHAR(32);

-- CreateTable
CREATE TABLE "config_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "yaml_text" TEXT NOT NULL,
    "status" "ConfigVersionStatus" NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolled_back_from" UUID,

    CONSTRAINT "config_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "config_version_tenant_id_status_idx" ON "config_version"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "config_version_tenant_id_version_number_key" ON "config_version"("tenant_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "latency_hop_session_id_utterance_seq_hop_node_id_key" ON "latency_hop"("session_id", "utterance_seq", "hop", "node_id");

