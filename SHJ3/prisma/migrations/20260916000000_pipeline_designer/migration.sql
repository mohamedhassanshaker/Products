BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [tenant_template].[PipelineDesigns] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [slug] VARCHAR(120) NOT NULL,
    [description] NVARCHAR(1000),
    [ownerTenantId] CHAR(26) NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [currentVersionId] CHAR(26),
    [createdByStaffUserId] CHAR(26) NOT NULL,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PipelineDesigns_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[PipelineVersions] (
    [id] CHAR(26) NOT NULL,
    [pipelineDesignId] CHAR(26) NOT NULL,
    [major] SMALLINT NOT NULL,
    [minor] SMALLINT NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [isCurrent] BIT NOT NULL,
    [entryNodeId] CHAR(26),
    [maxTotalHops] TINYINT NOT NULL,
    [costCeilingTokens] INT NOT NULL,
    [costCeilingMicroAed] BIGINT NOT NULL,
    [defaultMergePolicy] VARCHAR(32) NOT NULL,
    [defaultConflictResolution] VARCHAR(32) NOT NULL,
    [routingStrategy] VARCHAR(24) NOT NULL,
    [minRoutingConfidence] DECIMAL(5,4) NOT NULL,
    [fallbackAgentId] CHAR(26),
    [changeSummary] NVARCHAR(1000),
    [createdByStaffUserId] CHAR(26) NOT NULL,
    [publishedAt] DATETIME2,
    [publishedByStaffUserId] CHAR(26),
    [clonedFromVersionId] CHAR(26),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PipelineVersions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PipelineVersions_designId_major_minor] UNIQUE NONCLUSTERED ([pipelineDesignId],[major],[minor])
);

-- CreateTable
CREATE TABLE [tenant_template].[PipelineNodes] (
    [id] CHAR(26) NOT NULL,
    [pipelineVersionId] CHAR(26) NOT NULL,
    [key] VARCHAR(64) NOT NULL,
    [kind] VARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [canvasX] INT NOT NULL,
    [canvasY] INT NOT NULL,
    [agentId] CHAR(26),
    [usesTurnBoundAgent] BIT NOT NULL CONSTRAINT [PipelineNodes_usesTurnBoundAgent_df] DEFAULT 0,
    [agentVersionPinId] CHAR(26),
    [inputContextMode] VARCHAR(24) NOT NULL,
    [mergePolicyOverride] VARCHAR(32),
    [conflictResolutionOverride] VARCHAR(32),
    [isOwningEntity] BIT NOT NULL CONSTRAINT [PipelineNodes_isOwningEntity_df] DEFAULT 0,
    [costCeilingTokensOverride] INT,
    [costCeilingMicroAedOverride] BIGINT,
    [timeoutMsOverride] INT,
    [onErrorPolicy] VARCHAR(24) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PipelineNodes_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PipelineNodes_pipelineVersionId_key] UNIQUE NONCLUSTERED ([pipelineVersionId],[key])
);

-- CreateTable
CREATE TABLE [tenant_template].[PipelineEdges] (
    [id] CHAR(26) NOT NULL,
    [pipelineVersionId] CHAR(26) NOT NULL,
    [fromNodeId] CHAR(26) NOT NULL,
    [toNodeId] CHAR(26) NOT NULL,
    [kind] VARCHAR(16) NOT NULL,
    [ordinal] SMALLINT NOT NULL,
    [label] NVARCHAR(120),
    [maxIterations] TINYINT,
    [conditionExpression] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PipelineEdges_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PipelineEdges_from_ordinal] UNIQUE NONCLUSTERED ([pipelineVersionId],[fromNodeId],[ordinal]),
    CONSTRAINT [UQ_PipelineEdges_pair] UNIQUE NONCLUSTERED ([pipelineVersionId],[fromNodeId],[toNodeId])
);

-- CreateTable
CREATE TABLE [tenant_template].[PipelineVersionHistoryEntries] (
    [id] CHAR(26) NOT NULL,
    [pipelineDesignId] CHAR(26) NOT NULL,
    [pipelineVersionId] CHAR(26),
    [kind] VARCHAR(24) NOT NULL,
    [note] NVARCHAR(500) NOT NULL,
    [fromVersionId] CHAR(26),
    [actorStaffUserId] CHAR(26) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PipelineVersionHistoryEntries_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AlterTable
ALTER TABLE [tenant_template].[RouterConfigs] ADD [activePipelineVersionId] CHAR(26);

-- AlterTable
ALTER TABLE [tenant_template].[OrchestrationTraces] ADD
    [pipelineVersionId] CHAR(26),
    [pipelineDesignId] CHAR(26),
    [pipelineLabel] VARCHAR(16),
    [terminalNodeKey] VARCHAR(64),
    [branchCount] TINYINT NOT NULL CONSTRAINT [OrchestrationTraces_branchCount_df] DEFAULT 1,
    [loopIterationsTotal] TINYINT NOT NULL CONSTRAINT [OrchestrationTraces_loopIterationsTotal_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [tenant_template].[OrchestrationTraceSteps] ADD
    [pipelineNodeId] CHAR(26),
    [pipelineNodeKey] VARCHAR(64),
    [pipelineEdgeId] CHAR(26),
    [fromNodeKey] VARCHAR(64),
    [edgeKind] VARCHAR(16),
    [branchId] VARCHAR(32),
    [loopIteration] TINYINT,
    [depth] TINYINT;

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PipelineVersions_designId_status] ON [tenant_template].[PipelineVersions]([pipelineDesignId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PipelineVersionHistoryEntries_pipelineDesignId_occurredAt] ON [tenant_template].[PipelineVersionHistoryEntries]([pipelineDesignId], [occurredAt] DESC);

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineDesigns] ADD CONSTRAINT [PipelineDesigns_currentVersionId_fkey] FOREIGN KEY ([currentVersionId]) REFERENCES [tenant_template].[PipelineVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineVersions] ADD CONSTRAINT [PipelineVersions_pipelineDesignId_fkey] FOREIGN KEY ([pipelineDesignId]) REFERENCES [tenant_template].[PipelineDesigns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineVersions] ADD CONSTRAINT [PipelineVersions_entryNodeId_fkey] FOREIGN KEY ([entryNodeId]) REFERENCES [tenant_template].[PipelineNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineVersions] ADD CONSTRAINT [PipelineVersions_clonedFromVersionId_fkey] FOREIGN KEY ([clonedFromVersionId]) REFERENCES [tenant_template].[PipelineVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineVersions] ADD CONSTRAINT [PipelineVersions_fallbackAgentId_fkey] FOREIGN KEY ([fallbackAgentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineNodes] ADD CONSTRAINT [PipelineNodes_pipelineVersionId_fkey] FOREIGN KEY ([pipelineVersionId]) REFERENCES [tenant_template].[PipelineVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineNodes] ADD CONSTRAINT [PipelineNodes_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineNodes] ADD CONSTRAINT [PipelineNodes_agentVersionPinId_fkey] FOREIGN KEY ([agentVersionPinId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineEdges] ADD CONSTRAINT [PipelineEdges_pipelineVersionId_fkey] FOREIGN KEY ([pipelineVersionId]) REFERENCES [tenant_template].[PipelineVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineEdges] ADD CONSTRAINT [PipelineEdges_fromNodeId_fkey] FOREIGN KEY ([fromNodeId]) REFERENCES [tenant_template].[PipelineNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineEdges] ADD CONSTRAINT [PipelineEdges_toNodeId_fkey] FOREIGN KEY ([toNodeId]) REFERENCES [tenant_template].[PipelineNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineVersionHistoryEntries] ADD CONSTRAINT [PipelineVersionHistoryEntries_pipelineDesignId_fkey] FOREIGN KEY ([pipelineDesignId]) REFERENCES [tenant_template].[PipelineDesigns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineVersionHistoryEntries] ADD CONSTRAINT [PipelineVersionHistoryEntries_pipelineVersionId_fkey] FOREIGN KEY ([pipelineVersionId]) REFERENCES [tenant_template].[PipelineVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PipelineVersionHistoryEntries] ADD CONSTRAINT [PipelineVersionHistoryEntries_fromVersionId_fkey] FOREIGN KEY ([fromVersionId]) REFERENCES [tenant_template].[PipelineVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RouterConfigs] ADD CONSTRAINT [RouterConfigs_activePipelineVersionId_fkey] FOREIGN KEY ([activePipelineVersionId]) REFERENCES [tenant_template].[PipelineVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraces] ADD CONSTRAINT [OrchestrationTraces_pipelineVersionId_fkey] FOREIGN KEY ([pipelineVersionId]) REFERENCES [tenant_template].[PipelineVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraceSteps] ADD CONSTRAINT [OrchestrationTraceSteps_pipelineNodeId_fkey] FOREIGN KEY ([pipelineNodeId]) REFERENCES [tenant_template].[PipelineNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraceSteps] ADD CONSTRAINT [OrchestrationTraceSteps_pipelineEdgeId_fkey] FOREIGN KEY ([pipelineEdgeId]) REFERENCES [tenant_template].[PipelineEdges]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
