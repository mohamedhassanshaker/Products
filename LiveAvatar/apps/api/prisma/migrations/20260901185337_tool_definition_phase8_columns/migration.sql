-- AlterTable
ALTER TABLE "tool_definition" ADD COLUMN     "consequential" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lane" VARCHAR(16) NOT NULL DEFAULT 'foreground',
ADD COLUMN     "per_session_cap" INTEGER,
ADD COLUMN     "per_turn_cap" INTEGER,
ADD COLUMN     "timeout_ms" INTEGER NOT NULL DEFAULT 10000;
