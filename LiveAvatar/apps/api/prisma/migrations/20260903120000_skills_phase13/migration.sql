-- CreateEnum
CREATE TYPE "SkillTriggerMode" AS ENUM ('model', 'router');

-- CreateEnum
CREATE TYPE "SkillVersionStatus" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "skill" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "platform_published" BOOLEAN NOT NULL DEFAULT false,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "current_published_version_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "skill_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "instructions" TEXT NOT NULL,
    "trigger_mode" "SkillTriggerMode" NOT NULL DEFAULT 'model',
    "tools" JSONB NOT NULL DEFAULT '[]',
    "knowledge_filters" JSONB NOT NULL DEFAULT '{}',
    "budget_ms" INTEGER NOT NULL DEFAULT 1500,
    "environments" TEXT[] DEFAULT ARRAY['dev', 'staging', 'production']::TEXT[],
    "status" "SkillVersionStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skill_tenant_id_slug_key" ON "skill"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "skill_tenant_id_idx" ON "skill"("tenant_id");

-- CreateIndex
CREATE INDEX "skill_version_skill_id_status_idx" ON "skill_version"("skill_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "skill_version_skill_id_version_number_key" ON "skill_version"("skill_id", "version_number");

-- AddForeignKey
ALTER TABLE "skill" ADD CONSTRAINT "skill_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
