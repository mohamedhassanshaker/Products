BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'platform') EXEC sp_executesql N'CREATE SCHEMA [platform];';

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'tenant_template') EXEC sp_executesql N'CREATE SCHEMA [tenant_template];';

-- CreateTable
CREATE TABLE [platform].[Tenants] (
    [id] CHAR(26) NOT NULL,
    [slug] VARCHAR(30) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [entityKind] VARCHAR(32) NOT NULL,
    [sqlSchema] VARCHAR(30) NOT NULL,
    [neo4jTenantLabel] VARCHAR(38) NOT NULL,
    [qdrantCollection] VARCHAR(63) NOT NULL,
    [redisPrefix] VARCHAR(30) NOT NULL,
    [dataResidency] VARCHAR(32) NOT NULL,
    [status] VARCHAR(24) NOT NULL,
    [activatedAt] DATETIME2,
    [suspendedAt] DATETIME2,
    [deprovisionedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Tenants_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_Tenants_slug] UNIQUE NONCLUSTERED ([slug]),
    CONSTRAINT [UQ_Tenants_neo4jTenantLabel] UNIQUE NONCLUSTERED ([neo4jTenantLabel]),
    CONSTRAINT [UQ_Tenants_qdrantCollection] UNIQUE NONCLUSTERED ([qdrantCollection])
);

-- CreateTable
CREATE TABLE [platform].[TenantProvisioningSteps] (
    [id] CHAR(26) NOT NULL,
    [tenantId] CHAR(26) NOT NULL,
    [store] VARCHAR(16) NOT NULL,
    [state] VARCHAR(16) NOT NULL,
    [attemptCount] INT NOT NULL,
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [rolledBackAt] DATETIME2,
    [lastError] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TenantProvisioningSteps_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_TenantProvisioningSteps_tenantId_store] UNIQUE NONCLUSTERED ([tenantId],[store])
);

-- CreateTable
CREATE TABLE [platform].[TenantMigrations] (
    [id] CHAR(26) NOT NULL,
    [tenantId] CHAR(26) NOT NULL,
    [migrationName] VARCHAR(200) NOT NULL,
    [checksum] CHAR(64) NOT NULL,
    [state] VARCHAR(16) NOT NULL,
    [migrationRunId] CHAR(26),
    [appliedAt] DATETIME2,
    [durationMs] INT,
    [error] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TenantMigrations_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_TenantMigrations_tenantId_migrationName] UNIQUE NONCLUSTERED ([tenantId],[migrationName])
);

-- CreateTable
CREATE TABLE [platform].[MigrationRuns] (
    [id] CHAR(26) NOT NULL,
    [migrationNamesJson] NVARCHAR(max) NOT NULL,
    [initiatedByStaffUserId] CHAR(26) NOT NULL,
    [state] VARCHAR(16) NOT NULL,
    [tenantsTotal] INT NOT NULL,
    [tenantsApplied] INT NOT NULL,
    [tenantsFailed] INT NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [finishedAt] DATETIME2,
    [resumedFromRunId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MigrationRuns_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [platform].[Environments] (
    [key] VARCHAR(16) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [ordinal] TINYINT NOT NULL,
    [promotesToKey] VARCHAR(16),
    [isLive] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Environments_pkey] PRIMARY KEY CLUSTERED ([key]),
    CONSTRAINT [UQ_Environments_ordinal] UNIQUE NONCLUSTERED ([ordinal])
);

-- CreateTable
CREATE TABLE [platform].[Permissions] (
    [key] VARCHAR(64) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [moduleKey] VARCHAR(32) NOT NULL,
    [ordinal] TINYINT NOT NULL,
    [description] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Permissions_pkey] PRIMARY KEY CLUSTERED ([key]),
    CONSTRAINT [UQ_Permissions_ordinal] UNIQUE NONCLUSTERED ([ordinal])
);

-- CreateTable
CREATE TABLE [platform].[Policies] (
    [policyKey] VARCHAR(64) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [detail] NVARCHAR(1000) NOT NULL,
    [kind] VARCHAR(32) NOT NULL,
    [defaultValueJson] NVARCHAR(max) NOT NULL,
    [floorValueJson] NVARCHAR(max),
    [isLocked] BIT NOT NULL,
    [appliesTo] VARCHAR(32) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Policies_pkey] PRIMARY KEY CLUSTERED ([policyKey])
);

-- CreateTable
CREATE TABLE [platform].[OverridablePolicies] (
    [policyKey] VARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [OverridablePolicies_pkey] PRIMARY KEY CLUSTERED ([policyKey])
);

-- CreateTable
CREATE TABLE [platform].[Locales] (
    [code] VARCHAR(16) NOT NULL,
    [englishName] NVARCHAR(200) NOT NULL,
    [nativeName] NVARCHAR(200) NOT NULL,
    [direction] VARCHAR(3) NOT NULL,
    [defaultVoiceName] NVARCHAR(80),
    [isEnabledPlatformWide] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Locales_pkey] PRIMARY KEY CLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [platform].[VectorCollectionRegistry] (
    [id] CHAR(26) NOT NULL,
    [tenantId] CHAR(26) NOT NULL,
    [collectionName] VARCHAR(63) NOT NULL,
    [aliasName] VARCHAR(63) NOT NULL,
    [embeddingModel] VARCHAR(64) NOT NULL,
    [embeddingDimension] INT NOT NULL,
    [distance] VARCHAR(16) NOT NULL,
    [pointCount] BIGINT NOT NULL,
    [lastFullReindexAt] DATETIME2,
    [state] VARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [VectorCollectionRegistry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_VectorCollectionRegistry_collectionName] UNIQUE NONCLUSTERED ([collectionName])
);

-- CreateTable
CREATE TABLE [platform].[PlatformAuditLogEntries] (
    [id] CHAR(26) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [actorStaffUserId] CHAR(26),
    [actorDisplayNameSnapshot] NVARCHAR(200) NOT NULL,
    [actorRoleSnapshot] NVARCHAR(120) NOT NULL,
    [action] VARCHAR(64) NOT NULL,
    [targetKind] VARCHAR(48) NOT NULL,
    [targetId] CHAR(26),
    [targetLabelSnapshot] NVARCHAR(300) NOT NULL,
    [environmentKey] VARCHAR(16),
    [beforeJson] NVARCHAR(max),
    [afterJson] NVARCHAR(max),
    [summary] NVARCHAR(500) NOT NULL,
    [correlationId] CHAR(26) NOT NULL,
    [requestId] CHAR(26),
    [ipHash] CHAR(64),
    [userAgentHash] CHAR(64),
    [sequenceNo] BIGINT NOT NULL IDENTITY(1,1),
    [prevHash] CHAR(64),
    [entryHash] CHAR(64) NOT NULL,
    [tenantId] CHAR(26),
    [tenantSlugSnapshot] NVARCHAR(30),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PK_PlatformAuditLogEntries] PRIMARY KEY NONCLUSTERED ([id]),
    CONSTRAINT [UQ_PlatformAuditLogEntries_sequenceNo] UNIQUE NONCLUSTERED ([sequenceNo])
);

-- CreateTable
CREATE TABLE [platform].[ErasureRequests] (
    [id] CHAR(26) NOT NULL,
    [subjectKind] VARCHAR(24) NOT NULL,
    [subjectHash] CHAR(64) NOT NULL,
    [tenantId] CHAR(26),
    [tenantSlugSnapshot] NVARCHAR(30),
    [receivedVia] VARCHAR(32) NOT NULL,
    [requestedAt] DATETIME2 NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [rejectionReason] NVARCHAR(500),
    [completedAt] DATETIME2,
    [verificationEvidenceJson] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ErasureRequests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [platform].[StaffUsers] (
    [id] CHAR(26) NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [homeTenantId] CHAR(26) NOT NULL,
    [invitedByStaffUserId] CHAR(26),
    [invitedAt] DATETIME2,
    [acceptedAt] DATETIME2,
    [lastLoginAt] DATETIME2,
    [sessionEpoch] INT NOT NULL CONSTRAINT [StaffUsers_sessionEpoch_df] DEFAULT 0,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StaffUsers_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [platform].[StaffCredentials] (
    [staffUserId] CHAR(26) NOT NULL,
    [passwordHash] NVARCHAR(255) NOT NULL,
    [passwordAlgorithm] VARCHAR(24) NOT NULL CONSTRAINT [StaffCredentials_passwordAlgorithm_df] DEFAULT 'argon2id',
    [passwordUpdatedAt] DATETIME2 NOT NULL,
    [mustChangePassword] BIT NOT NULL,
    [totpSecretCipher] VARBINARY(512),
    [totpEnrolledAt] DATETIME2,
    [failedAttemptCount] TINYINT NOT NULL,
    [lockedUntil] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StaffCredentials_pkey] PRIMARY KEY CLUSTERED ([staffUserId])
);

-- CreateTable
CREATE TABLE [platform].[TenantMemberships] (
    [id] CHAR(26) NOT NULL,
    [staffUserId] CHAR(26) NOT NULL,
    [tenantId] CHAR(26) NOT NULL,
    [isPrimary] BIT NOT NULL,
    [grantedByStaffUserId] CHAR(26) NOT NULL,
    [grantedAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TenantMemberships_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_TenantMemberships_staffUserId_tenantId] UNIQUE NONCLUSTERED ([staffUserId],[tenantId])
);

-- CreateTable
CREATE TABLE [platform].[TokenSets] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [kind] VARCHAR(16) NOT NULL,
    [mode] VARCHAR(8) NOT NULL,
    [schemaVersion] SMALLINT NOT NULL,
    [tokensJson] NVARCHAR(max) NOT NULL,
    [parentTokenSetId] CHAR(26),
    [contrastValidatedAt] DATETIME2,
    [contrastReportJson] NVARCHAR(max),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TokenSets_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [platform].[Skins] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [description] NVARCHAR(1000),
    [lightTokenSetId] CHAR(26) NOT NULL,
    [darkTokenSetId] CHAR(26) NOT NULL,
    [isSystem] BIT NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [duplicatedFromSkinId] CHAR(26),
    [exportSchemaVersion] SMALLINT NOT NULL,
    [createdByStaffUserId] CHAR(26),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Skins_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [platform].[GuideSections] (
    [id] CHAR(26) NOT NULL,
    [parentSectionId] CHAR(26),
    [title] NVARCHAR(200) NOT NULL,
    [slug] VARCHAR(120) NOT NULL,
    [ordinal] SMALLINT NOT NULL,
    [moduleKey] VARCHAR(32),
    [depth] TINYINT NOT NULL,
    [isPublished] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GuideSections_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_GuideSections_parent_slug] UNIQUE NONCLUSTERED ([parentSectionId],[slug]),
    CONSTRAINT [UQ_GuideSections_parent_ordinal] UNIQUE NONCLUSTERED ([parentSectionId],[ordinal])
);

-- CreateTable
CREATE TABLE [platform].[GuideEntries] (
    [id] CHAR(26) NOT NULL,
    [guideSectionId] CHAR(26) NOT NULL,
    [slug] VARCHAR(160) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [purpose] NVARCHAR(2000) NOT NULL,
    [walkthroughMarkdown] NVARCHAR(max) NOT NULL,
    [howToStepsJson] NVARCHAR(max) NOT NULL,
    [permissionNotesJson] NVARCHAR(max),
    [appRoute] NVARCHAR(300) NOT NULL,
    [screenRef] VARCHAR(24),
    [releaseVersion] VARCHAR(24) NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [updatedByStaffUserId] CHAR(26) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GuideEntries_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_GuideEntries_slug] UNIQUE NONCLUSTERED ([slug]),
    CONSTRAINT [UQ_GuideEntries_appRoute] UNIQUE NONCLUSTERED ([appRoute])
);

-- CreateTable
CREATE TABLE [platform].[GuideScreenshots] (
    [id] CHAR(26) NOT NULL,
    [guideEntryId] CHAR(26) NOT NULL,
    [guideAssetId] CHAR(26) NOT NULL,
    [caption] NVARCHAR(300),
    [localeCode] VARCHAR(16) NOT NULL,
    [ordinal] SMALLINT NOT NULL,
    [capturedAt] DATETIME2 NOT NULL,
    [capturedAppVersion] VARCHAR(24) NOT NULL,
    [isStale] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GuideScreenshots_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_GuideScreenshots_entry_locale_ordinal] UNIQUE NONCLUSTERED ([guideEntryId],[localeCode],[ordinal])
);

-- CreateTable
CREATE TABLE [platform].[GuideAssets] (
    [id] CHAR(26) NOT NULL,
    [fileName] NVARCHAR(260) NOT NULL,
    [mimeType] VARCHAR(120) NOT NULL,
    [byteSize] INT NOT NULL,
    [width] SMALLINT NOT NULL,
    [height] SMALLINT NOT NULL,
    [checksum] CHAR(64) NOT NULL,
    [storageRef] NVARCHAR(500) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GuideAssets_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_GuideAssets_checksum] UNIQUE NONCLUSTERED ([checksum])
);

-- CreateTable
CREATE TABLE [platform].[GuideEntryTranslations] (
    [id] CHAR(26) NOT NULL,
    [guideEntryId] CHAR(26) NOT NULL,
    [localeCode] VARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [purpose] NVARCHAR(2000) NOT NULL,
    [walkthroughMarkdown] NVARCHAR(max) NOT NULL,
    [howToStepsJson] NVARCHAR(max) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GuideEntryTranslations_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_GuideEntryTranslations_entry_locale] UNIQUE NONCLUSTERED ([guideEntryId],[localeCode])
);

-- CreateTable
CREATE TABLE [platform].[GuideCoverageChecks] (
    [id] CHAR(26) NOT NULL,
    [appRoute] NVARCHAR(300) NOT NULL,
    [discoveredAt] DATETIME2 NOT NULL,
    [guideEntryId] CHAR(26),
    [hasEntry] BIT NOT NULL,
    [hasCurrentScreenshot] BIT NOT NULL,
    [lastCheckedAt] DATETIME2 NOT NULL,
    [releaseVersion] VARCHAR(24) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GuideCoverageChecks_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_GuideCoverageChecks_appRoute] UNIQUE NONCLUSTERED ([appRoute])
);

-- CreateTable
CREATE TABLE [tenant_template].[TenantProfiles] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [TenantProfiles_singletonKey_df] DEFAULT 1,
    [tenantId] CHAR(26) NOT NULL,
    [slug] VARCHAR(30) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [isPlatformTenant] BIT NOT NULL,
    [dataResidency] VARCHAR(32) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TenantProfiles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_TenantProfiles_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[OutboxEvents] (
    [id] CHAR(26) NOT NULL,
    [aggregateKind] VARCHAR(48) NOT NULL,
    [aggregateId] CHAR(26) NOT NULL,
    [eventType] VARCHAR(64) NOT NULL,
    [targetStore] VARCHAR(16) NOT NULL,
    [payloadJson] NVARCHAR(max) NOT NULL,
    [dedupeKey] VARCHAR(160) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [attemptCount] INT NOT NULL CONSTRAINT [OutboxEvents_attemptCount_df] DEFAULT 0,
    [maxAttempts] INT NOT NULL CONSTRAINT [OutboxEvents_maxAttempts_df] DEFAULT 8,
    [availableAt] DATETIME2 NOT NULL,
    [lockedBy] VARCHAR(64),
    [lockedUntil] DATETIME2,
    [lastError] NVARCHAR(max),
    [appliedAt] DATETIME2,
    [occurredAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [OutboxEvents_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_OutboxEvents_dedupeKey] UNIQUE NONCLUSTERED ([dedupeKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[ReconciliationRuns] (
    [id] CHAR(26) NOT NULL,
    [store] VARCHAR(16) NOT NULL,
    [scope] VARCHAR(16) NOT NULL,
    [knowledgeSourceId] CHAR(26),
    [expectedCount] INT NOT NULL,
    [observedCount] INT NOT NULL,
    [driftFound] INT NOT NULL,
    [driftRepaired] INT NOT NULL,
    [deadOutboxRequeued] INT NOT NULL,
    [reindexJobId] CHAR(26),
    [state] VARCHAR(12) NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [finishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ReconciliationRuns_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[Teams] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [scope] VARCHAR(16) NOT NULL,
    [description] NVARCHAR(1000),
    [isSystem] BIT NOT NULL,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Teams_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[TeamMembers] (
    [id] CHAR(26) NOT NULL,
    [teamId] CHAR(26) NOT NULL,
    [staffUserId] CHAR(26) NOT NULL,
    [isPrimary] BIT NOT NULL,
    [addedByStaffUserId] CHAR(26) NOT NULL,
    [addedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TeamMembers_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_TeamMembers_teamId_staffUserId] UNIQUE NONCLUSTERED ([teamId],[staffUserId])
);

-- CreateTable
CREATE TABLE [tenant_template].[Roles] (
    [id] CHAR(26) NOT NULL,
    [key] VARCHAR(64) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [isSystem] BIT NOT NULL,
    [ordinal] SMALLINT NOT NULL,
    [description] NVARCHAR(1000),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Roles_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[RolePermissions] (
    [id] CHAR(26) NOT NULL,
    [roleId] CHAR(26) NOT NULL,
    [permissionKey] VARCHAR(64) NOT NULL,
    [grantedByStaffUserId] CHAR(26) NOT NULL,
    [grantedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RolePermissions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_RolePermissions_roleId_permissionKey] UNIQUE NONCLUSTERED ([roleId],[permissionKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[UserRoleAssignments] (
    [id] CHAR(26) NOT NULL,
    [staffUserId] CHAR(26) NOT NULL,
    [roleId] CHAR(26) NOT NULL,
    [scopeTeamId] CHAR(26),
    [assignedByStaffUserId] CHAR(26) NOT NULL,
    [assignedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [UserRoleAssignments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_UserRoleAssignments_staffUserId_roleId] UNIQUE NONCLUSTERED ([staffUserId],[roleId])
);

-- CreateTable
CREATE TABLE [tenant_template].[Conversations] (
    [id] CHAR(26) NOT NULL,
    [channelKey] VARCHAR(24) NOT NULL,
    [localeCode] VARCHAR(16) NOT NULL,
    [citizenIdentityId] CHAR(26),
    [primaryAgentId] CHAR(26),
    [intentKey] VARCHAR(64),
    [outcome] VARCHAR(16) NOT NULL,
    [wasContained] BIT NOT NULL,
    [turnCount] INT NOT NULL,
    [externalSubjectHash] CHAR(64),
    [redisSessionKey] NVARCHAR(120),
    [startedAt] DATETIME2 NOT NULL,
    [lastTurnAt] DATETIME2 NOT NULL,
    [endedAt] DATETIME2,
    [piiMaskApplied] BIT NOT NULL,
    [retentionExpiresAt] DATETIME2 NOT NULL,
    [erasedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Conversations_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[ConversationTurns] (
    [id] CHAR(26) NOT NULL,
    [conversationId] CHAR(26) NOT NULL,
    [ordinal] INT NOT NULL,
    [role] VARCHAR(16) NOT NULL,
    [contentMasked] NVARCHAR(max) NOT NULL,
    [contentFormat] VARCHAR(16) NOT NULL,
    [agentVersionId] CHAR(26),
    [localeCode] VARCHAR(16) NOT NULL,
    [inputTokens] INT,
    [outputTokens] INT,
    [latencyMs] INT,
    [wasRefused] BIT NOT NULL,
    [refusalReason] VARCHAR(48),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ConversationTurns_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_ConversationTurns_conversationId_ordinal] UNIQUE NONCLUSTERED ([conversationId],[ordinal])
);

-- CreateTable
CREATE TABLE [tenant_template].[MessageFeedback] (
    [id] CHAR(26) NOT NULL,
    [turnId] CHAR(26) NOT NULL,
    [rating] VARCHAR(8) NOT NULL,
    [reasonTag] VARCHAR(48),
    [comment] NVARCHAR(1000),
    [submittedByCitizen] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MessageFeedback_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_MessageFeedback_turnId] UNIQUE NONCLUSTERED ([turnId])
);

-- CreateTable
CREATE TABLE [tenant_template].[ConversationSlots] (
    [id] CHAR(26) NOT NULL,
    [conversationId] CHAR(26) NOT NULL,
    [name] VARCHAR(64) NOT NULL,
    [valueMasked] NVARCHAR(256),
    [status] VARCHAR(16) NOT NULL,
    [requiredAssurance] VARCHAR(32) NOT NULL,
    [openedAt] DATETIME2 NOT NULL,
    [filledAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ConversationSlots_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_ConversationSlots_conversationId_name] UNIQUE NONCLUSTERED ([conversationId],[name])
);

-- CreateTable
CREATE TABLE [tenant_template].[QuickActions] (
    [id] CHAR(26) NOT NULL,
    [label] NVARCHAR(80) NOT NULL,
    [localeCode] VARCHAR(16) NOT NULL,
    [payloadIntentKey] VARCHAR(64) NOT NULL,
    [ordinal] SMALLINT NOT NULL,
    [channelScope] VARCHAR(24) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [agentId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [QuickActions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_QuickActions_localeCode_channelScope_ordinal] UNIQUE NONCLUSTERED ([localeCode],[channelScope],[ordinal])
);

-- CreateTable
CREATE TABLE [tenant_template].[Agents] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [slug] VARCHAR(120) NOT NULL,
    [description] NVARCHAR(1000),
    [ownerTenantId] CHAR(26) NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [currentVersionId] CHAR(26),
    [clonedFromAgentId] CHAR(26),
    [createdByStaffUserId] CHAR(26) NOT NULL,
    [archivedAt] DATETIME2,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Agents_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentVersions] (
    [id] CHAR(26) NOT NULL,
    [agentId] CHAR(26) NOT NULL,
    [major] SMALLINT NOT NULL,
    [minor] SMALLINT NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [isCurrent] BIT NOT NULL,
    [systemPrompt] NVARCHAR(max) NOT NULL,
    [tone] VARCHAR(16) NOT NULL,
    [primaryModel] VARCHAR(120) NOT NULL,
    [fallbackModel] VARCHAR(120),
    [temperature] DECIMAL(3,2) NOT NULL,
    [maxOutputTokens] INT NOT NULL,
    [changeSummary] NVARCHAR(1000),
    [configHash] CHAR(64) NOT NULL,
    [createdByStaffUserId] CHAR(26) NOT NULL,
    [publishedAt] DATETIME2,
    [publishedByStaffUserId] CHAR(26),
    [clonedFromVersionId] CHAR(26),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentVersions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_AgentVersions_agentId_major_minor] UNIQUE NONCLUSTERED ([agentId],[major],[minor])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentVersionHistoryEntries] (
    [id] CHAR(26) NOT NULL,
    [agentId] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26),
    [kind] VARCHAR(24) NOT NULL,
    [note] NVARCHAR(500) NOT NULL,
    [fromVersionId] CHAR(26),
    [actorStaffUserId] CHAR(26) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentVersionHistoryEntries_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentKnowledgeBindings] (
    [id] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [knowledgeCollectionId] CHAR(26) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [boundByStaffUserId] CHAR(26) NOT NULL,
    [boundAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentKnowledgeBindings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_AgentKnowledgeBindings_agentVersionId_knowledgeCollectionId] UNIQUE NONCLUSTERED ([agentVersionId],[knowledgeCollectionId])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentFlowBindings] (
    [id] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [flowId] CHAR(26) NOT NULL,
    [flowVersionId] CHAR(26) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [ordinal] SMALLINT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentFlowBindings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_AgentFlowBindings_agentVersionId_flowId] UNIQUE NONCLUSTERED ([agentVersionId],[flowId])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentChannelBindings] (
    [id] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [channelKey] VARCHAR(24) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentChannelBindings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_AgentChannelBindings_agentVersionId_channelKey] UNIQUE NONCLUSTERED ([agentVersionId],[channelKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentLocaleBindings] (
    [id] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [localeCode] VARCHAR(16) NOT NULL,
    [isPrimary] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentLocaleBindings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_AgentLocaleBindings_agentVersionId_localeCode] UNIQUE NONCLUSTERED ([agentVersionId],[localeCode])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentSandboxRuns] (
    [id] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [transcriptJson] NVARCHAR(max) NOT NULL,
    [promptText] NVARCHAR(max) NOT NULL,
    [ranByStaffUserId] CHAR(26) NOT NULL,
    [traceJson] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentSandboxRuns_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentWizardDrafts] (
    [id] CHAR(26) NOT NULL,
    [agentId] CHAR(26),
    [agentVersionId] CHAR(26),
    [ownerStaffUserId] CHAR(26) NOT NULL,
    [lastStep] TINYINT NOT NULL,
    [stepStateJson] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentWizardDrafts_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_AgentWizardDrafts_ownerStaffUserId_agentId] UNIQUE NONCLUSTERED ([ownerStaffUserId],[agentId])
);

-- CreateTable
CREATE TABLE [tenant_template].[RouterConfigs] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [RouterConfigs_singletonKey_df] DEFAULT 1,
    [executionMode] VARCHAR(24) NOT NULL,
    [routingStrategy] VARCHAR(24) NOT NULL,
    [agentSelectionScope] VARCHAR(24) NOT NULL,
    [agentScopeListJson] NVARCHAR(max),
    [maxHops] TINYINT NOT NULL,
    [maxLoopIterations] TINYINT NOT NULL,
    [costCeilingTokens] INT NOT NULL,
    [costCeilingMicroAed] BIGINT NOT NULL,
    [conflictResolution] VARCHAR(32) NOT NULL,
    [responseMergePolicy] VARCHAR(32) NOT NULL,
    [fallbackAgentId] CHAR(26),
    [minRoutingConfidence] DECIMAL(5,4) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RouterConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_RouterConfigs_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[OrchestrationTraces] (
    [id] CHAR(26) NOT NULL,
    [conversationId] CHAR(26) NOT NULL,
    [turnId] CHAR(26) NOT NULL,
    [executionMode] VARCHAR(24) NOT NULL,
    [routedAgentId] CHAR(26),
    [routedAgentVersionId] CHAR(26),
    [routingConfidence] DECIMAL(5,4),
    [hopCount] TINYINT NOT NULL,
    [totalInputTokens] INT NOT NULL,
    [totalOutputTokens] INT NOT NULL,
    [totalCostMicroAed] BIGINT NOT NULL,
    [pendingSlotName] VARCHAR(64),
    [escapeTriggered] BIT NOT NULL,
    [mergePolicyApplied] VARCHAR(32),
    [guardrailPreResult] VARCHAR(16) NOT NULL,
    [guardrailPostResult] VARCHAR(16) NOT NULL,
    [groundingConfidence] DECIMAL(5,4),
    [startedAt] DATETIME2 NOT NULL,
    [durationMs] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [OrchestrationTraces_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_OrchestrationTraces_turnId] UNIQUE NONCLUSTERED ([turnId])
);

-- CreateTable
CREATE TABLE [tenant_template].[OrchestrationTraceSteps] (
    [id] CHAR(26) NOT NULL,
    [traceId] CHAR(26) NOT NULL,
    [ordinal] SMALLINT NOT NULL,
    [kind] VARCHAR(24) NOT NULL,
    [agentId] CHAR(26),
    [toolBindingId] CHAR(26),
    [label] NVARCHAR(300) NOT NULL,
    [argumentsMasked] NVARCHAR(max),
    [resultSummary] NVARCHAR(1000),
    [confidence] DECIMAL(5,4),
    [status] VARCHAR(16) NOT NULL,
    [errorCode] VARCHAR(64),
    [isSecondaryAgent] BIT NOT NULL,
    [durationMs] INT NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [OrchestrationTraceSteps_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_OrchestrationTraceSteps_traceId_ordinal] UNIQUE NONCLUSTERED ([traceId],[ordinal])
);

-- CreateTable
CREATE TABLE [tenant_template].[GroundingCitations] (
    [id] CHAR(26) NOT NULL,
    [traceId] CHAR(26) NOT NULL,
    [turnId] CHAR(26) NOT NULL,
    [chunkId] CHAR(26) NOT NULL,
    [knowledgeSourceId] CHAR(26) NOT NULL,
    [rank] SMALLINT NOT NULL,
    [vectorScore] DECIMAL(6,5),
    [graphScore] DECIMAL(6,5),
    [hybridScore] DECIMAL(6,5) NOT NULL,
    [rerankScore] DECIMAL(6,5),
    [retrievedVia] VARCHAR(16) NOT NULL,
    [graphPath] NVARCHAR(500),
    [wasCited] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GroundingCitations_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_GroundingCitations_traceId_rank] UNIQUE NONCLUSTERED ([traceId],[rank])
);

-- CreateTable
CREATE TABLE [tenant_template].[Skills] (
    [id] CHAR(26) NOT NULL,
    [key] VARCHAR(96) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [category] VARCHAR(48),
    [invocationKind] VARCHAR(24) NOT NULL,
    [apiConnectorId] CHAR(26),
    [mcpToolId] CHAR(26),
    [inputSchemaJson] NVARCHAR(max) NOT NULL,
    [outputSchemaJson] NVARCHAR(max),
    [rateLimitPolicyId] CHAR(26),
    [isSystem] BIT NOT NULL,
    [isAttachedByDefault] BIT NOT NULL,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Skills_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[McpServers] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [endpoint] NVARCHAR(500) NOT NULL,
    [transport] VARCHAR(16) NOT NULL,
    [authMode] VARCHAR(32) NOT NULL,
    [credentialSecretRef] NVARCHAR(200),
    [connectionState] VARCHAR(16) NOT NULL,
    [lastDiscoveryAt] DATETIME2,
    [lastConnectedAt] DATETIME2,
    [lastError] NVARCHAR(2000),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [McpServers_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[McpTools] (
    [id] CHAR(26) NOT NULL,
    [mcpServerId] CHAR(26) NOT NULL,
    [name] VARCHAR(120) NOT NULL,
    [description] NVARCHAR(1000),
    [inputSchemaJson] NVARCHAR(max) NOT NULL,
    [discoveredAt] DATETIME2 NOT NULL,
    [lastSeenAt] DATETIME2 NOT NULL,
    [removedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [McpTools_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_McpTools_mcpServerId_name] UNIQUE NONCLUSTERED ([mcpServerId],[name])
);

-- CreateTable
CREATE TABLE [tenant_template].[ApiConnectors] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [method] VARCHAR(8) NOT NULL,
    [urlTemplate] NVARCHAR(1000) NOT NULL,
    [authMode] VARCHAR(32) NOT NULL,
    [credentialSecretRef] NVARCHAR(200),
    [headersJson] NVARCHAR(max),
    [requestSchemaJson] NVARCHAR(max),
    [responseSchemaJson] NVARCHAR(max),
    [timeoutMs] INT NOT NULL,
    [testState] VARCHAR(16) NOT NULL,
    [lastTestedAt] DATETIME2,
    [sampleResponseJson] NVARCHAR(max),
    [rateLimitPolicyId] CHAR(26) NOT NULL,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ApiConnectors_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[RateLimitPolicies] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [requestsPerWindow] INT NOT NULL,
    [windowSeconds] INT NOT NULL,
    [burst] INT NOT NULL,
    [scope] VARCHAR(24) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RateLimitPolicies_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_RateLimitPolicies_name] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [tenant_template].[ToolBindings] (
    [id] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [targetKind] VARCHAR(16) NOT NULL,
    [skillId] CHAR(26),
    [mcpToolId] CHAR(26),
    [apiConnectorId] CHAR(26),
    [isEnabled] BIT NOT NULL,
    [argumentPolicyJson] NVARCHAR(max),
    [requiredAssurance] VARCHAR(32) NOT NULL,
    [rateLimitPolicyId] CHAR(26),
    [boundByStaffUserId] CHAR(26) NOT NULL,
    [boundAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ToolBindings_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[CircuitBreakerConfigs] (
    [id] CHAR(26) NOT NULL,
    [targetKind] VARCHAR(16) NOT NULL,
    [targetId] CHAR(26),
    [targetKey] VARCHAR(64),
    [failureThreshold] SMALLINT NOT NULL,
    [windowSeconds] INT NOT NULL,
    [cooldownSeconds] INT NOT NULL,
    [halfOpenProbes] TINYINT NOT NULL,
    [fallbackStrategy] VARCHAR(32) NOT NULL,
    [cachedAnswerMaxAgeSeconds] INT,
    [serveCachedWhenDown] BIT NOT NULL,
    [degradedModeMessage] NVARCHAR(500) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CircuitBreakerConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_CircuitBreakerConfigs_target] UNIQUE NONCLUSTERED ([targetKind],[targetId],[targetKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[CircuitBreakerEvents] (
    [id] CHAR(26) NOT NULL,
    [circuitBreakerConfigId] CHAR(26) NOT NULL,
    [transition] VARCHAR(12) NOT NULL,
    [reason] VARCHAR(32) NOT NULL,
    [failureCount] SMALLINT,
    [actorStaffUserId] CHAR(26),
    [occurredAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CircuitBreakerEvents_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[KnowledgeCollections] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [slug] VARCHAR(96) NOT NULL,
    [description] NVARCHAR(1000),
    [ownerTenantId] CHAR(26) NOT NULL,
    [retrievalConfigId] CHAR(26),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [KnowledgeCollections_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[KnowledgeSources] (
    [id] CHAR(26) NOT NULL,
    [knowledgeCollectionId] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [sourceType] VARCHAR(16) NOT NULL,
    [location] NVARCHAR(1000) NOT NULL,
    [ownerTenantId] CHAR(26) NOT NULL,
    [schedule] VARCHAR(12) NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [documentCount] INT NOT NULL,
    [chunkCount] INT NOT NULL,
    [indexedChunkCount] INT NOT NULL,
    [lastCrawledAt] DATETIME2,
    [nextScheduledAt] DATETIME2,
    [lastError] NVARCHAR(max),
    [credentialSecretRef] NVARCHAR(200),
    [removedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [KnowledgeSources_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[SourceDocuments] (
    [id] CHAR(26) NOT NULL,
    [knowledgeSourceId] CHAR(26) NOT NULL,
    [externalRef] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(500),
    [contentHash] CHAR(64) NOT NULL,
    [byteSize] BIGINT NOT NULL,
    [mimeType] VARCHAR(120) NOT NULL,
    [localeCode] VARCHAR(16),
    [storageRef] NVARCHAR(500) NOT NULL,
    [fetchedAt] DATETIME2 NOT NULL,
    [supersededByDocumentId] CHAR(26),
    [supersededAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SourceDocuments_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[Chunks] (
    [id] CHAR(26) NOT NULL,
    [sourceDocumentId] CHAR(26) NOT NULL,
    [knowledgeSourceId] CHAR(26) NOT NULL,
    [knowledgeCollectionId] CHAR(26) NOT NULL,
    [ordinal] INT NOT NULL,
    [text] NVARCHAR(max) NOT NULL,
    [tokenCount] SMALLINT NOT NULL,
    [charStart] INT NOT NULL,
    [charEnd] INT NOT NULL,
    [contentHash] CHAR(64) NOT NULL,
    [sectionPath] NVARCHAR(500),
    [pageNumber] INT,
    [localeCode] VARCHAR(16) NOT NULL,
    [embeddingModel] VARCHAR(64),
    [embeddingDimension] INT,
    [embeddedAt] DATETIME2,
    [vectorState] VARCHAR(12) NOT NULL,
    [graphState] VARCHAR(12) NOT NULL,
    [erasedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Chunks_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_Chunks_sourceDocumentId_ordinal] UNIQUE NONCLUSTERED ([sourceDocumentId],[ordinal])
);

-- CreateTable
CREATE TABLE [tenant_template].[IngestionRuns] (
    [id] CHAR(26) NOT NULL,
    [knowledgeSourceId] CHAR(26) NOT NULL,
    [trigger] VARCHAR(16) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [documentsSeen] INT NOT NULL,
    [documentsAdded] INT NOT NULL,
    [documentsUpdated] INT NOT NULL,
    [documentsRemoved] INT NOT NULL,
    [chunksWritten] INT NOT NULL,
    [chunksSkippedUnchanged] INT NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [finishedAt] DATETIME2,
    [error] NVARCHAR(max),
    [ranByStaffUserId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [IngestionRuns_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[ReindexJobs] (
    [id] CHAR(26) NOT NULL,
    [scope] VARCHAR(16) NOT NULL,
    [knowledgeSourceId] CHAR(26),
    [knowledgeCollectionId] CHAR(26),
    [reason] VARCHAR(32) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [progressPercent] TINYINT NOT NULL,
    [chunksTotal] INT,
    [chunksProcessed] INT NOT NULL,
    [targetEmbeddingModel] VARCHAR(64),
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [error] NVARCHAR(max),
    [ranByStaffUserId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ReindexJobs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[RetrievalConfigs] (
    [id] CHAR(26) NOT NULL,
    [scope] VARCHAR(12) NOT NULL,
    [knowledgeCollectionId] CHAR(26),
    [chunkSizeTokens] SMALLINT NOT NULL CONSTRAINT [RetrievalConfigs_chunkSizeTokens_df] DEFAULT 512,
    [chunkOverlapTokens] SMALLINT NOT NULL CONSTRAINT [RetrievalConfigs_chunkOverlapTokens_df] DEFAULT 64,
    [embeddingModel] VARCHAR(64) NOT NULL CONSTRAINT [RetrievalConfigs_embeddingModel_df] DEFAULT 'text-embedding-3-large',
    [embeddingDimension] INT NOT NULL CONSTRAINT [RetrievalConfigs_embeddingDimension_df] DEFAULT 3072,
    [graphWeight] DECIMAL(4,3) NOT NULL CONSTRAINT [RetrievalConfigs_graphWeight_df] DEFAULT 0.600,
    [vectorWeight] DECIMAL(4,3) NOT NULL CONSTRAINT [RetrievalConfigs_vectorWeight_df] DEFAULT 0.400,
    [topK] SMALLINT NOT NULL CONSTRAINT [RetrievalConfigs_topK_df] DEFAULT 8,
    [rerankerEnabled] BIT NOT NULL CONSTRAINT [RetrievalConfigs_rerankerEnabled_df] DEFAULT 1,
    [rerankerModel] VARCHAR(64) CONSTRAINT [RetrievalConfigs_rerankerModel_df] DEFAULT 'rerank-v3.5',
    [rerankCandidateCount] SMALLINT NOT NULL CONSTRAINT [RetrievalConfigs_rerankCandidateCount_df] DEFAULT 40,
    [minGroundingConfidence] DECIMAL(5,4) NOT NULL CONSTRAINT [RetrievalConfigs_minGroundingConfidence_df] DEFAULT 0.6000,
    [defaultConflictPolicy] VARCHAR(32) NOT NULL,
    [maxGraphHops] TINYINT NOT NULL CONSTRAINT [RetrievalConfigs_maxGraphHops_df] DEFAULT 3,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RetrievalConfigs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[RetrievalPlaygroundRuns] (
    [id] CHAR(26) NOT NULL,
    [query] NVARCHAR(2000) NOT NULL,
    [configSnapshotJson] NVARCHAR(max) NOT NULL,
    [resultsJson] NVARCHAR(max) NOT NULL,
    [matchedSubgraph] NVARCHAR(2000),
    [topScore] DECIMAL(6,5),
    [ranByStaffUserId] CHAR(26) NOT NULL,
    [durationMs] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RetrievalPlaygroundRuns_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[SourceConflicts] (
    [id] CHAR(26) NOT NULL,
    [topic] NVARCHAR(300) NOT NULL,
    [graphNodeRecordId] CHAR(26),
    [graphEntityKey] VARCHAR(200) NOT NULL,
    [sideAChunkId] CHAR(26) NOT NULL,
    [sideAKnowledgeSourceId] CHAR(26) NOT NULL,
    [sideAValue] NVARCHAR(500) NOT NULL,
    [sideASourceUpdatedAt] DATETIME2 NOT NULL,
    [sideBChunkId] CHAR(26) NOT NULL,
    [sideBKnowledgeSourceId] CHAR(26) NOT NULL,
    [sideBValue] NVARCHAR(500) NOT NULL,
    [sideBSourceUpdatedAt] DATETIME2 NOT NULL,
    [detectedAt] DATETIME2 NOT NULL,
    [detectionMethod] VARCHAR(32) NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [policyAtDetection] VARCHAR(32) NOT NULL,
    [authoritativeSide] CHAR(1),
    [resolvedByStaffUserId] CHAR(26),
    [resolvedAt] DATETIME2,
    [groundingPenalty] DECIMAL(4,3) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SourceConflicts_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[GraphNodeRecords] (
    [id] CHAR(26) NOT NULL,
    [label] VARCHAR(24) NOT NULL,
    [canonicalKey] VARCHAR(200) NOT NULL,
    [canonicalName] NVARCHAR(300) NOT NULL,
    [aliasesJson] NVARCHAR(max),
    [propertiesJson] NVARCHAR(max),
    [origin] VARCHAR(16) NOT NULL,
    [authoredByStaffUserId] CHAR(26),
    [firstSeenChunkId] CHAR(26),
    [mergedIntoNodeRecordId] CHAR(26),
    [mergedAt] DATETIME2,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GraphNodeRecords_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[GraphEdgeRecords] (
    [id] CHAR(26) NOT NULL,
    [fromNodeRecordId] CHAR(26) NOT NULL,
    [toNodeRecordId] CHAR(26) NOT NULL,
    [relationshipType] VARCHAR(32) NOT NULL,
    [propertiesJson] NVARCHAR(max),
    [origin] VARCHAR(16) NOT NULL,
    [evidenceChunkId] CHAR(26),
    [confidence] DECIMAL(4,3),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GraphEdgeRecords_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[GraphDuplicateCandidates] (
    [id] CHAR(26) NOT NULL,
    [leftNodeRecordId] CHAR(26) NOT NULL,
    [rightNodeRecordId] CHAR(26) NOT NULL,
    [similarity] DECIMAL(4,3) NOT NULL,
    [detectionMethod] VARCHAR(32) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [detectedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GraphDuplicateCandidates_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[GraphMergeDecisions] (
    [id] CHAR(26) NOT NULL,
    [graphDuplicateCandidateId] CHAR(26) NOT NULL,
    [decision] VARCHAR(8) NOT NULL,
    [survivingNodeRecordId] CHAR(26),
    [absorbedNodeRecordId] CHAR(26),
    [aliasesAddedJson] NVARCHAR(max),
    [edgesRewiredCount] INT NOT NULL,
    [decidedByStaffUserId] CHAR(26) NOT NULL,
    [decidedAt] DATETIME2 NOT NULL,
    [reindexJobId] CHAR(26),
    [revertedAt] DATETIME2,
    [revertedByStaffUserId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GraphMergeDecisions_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[Flows] (
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
    CONSTRAINT [Flows_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[FlowVersions] (
    [id] CHAR(26) NOT NULL,
    [flowId] CHAR(26) NOT NULL,
    [major] SMALLINT NOT NULL,
    [minor] SMALLINT NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [isCurrent] BIT NOT NULL,
    [entryNodeId] CHAR(26),
    [freeTextEscapeEnabled] BIT NOT NULL CONSTRAINT [FlowVersions_freeTextEscapeEnabled_df] DEFAULT 1,
    [escapeNodeId] CHAR(26),
    [changeSummary] NVARCHAR(1000),
    [createdByStaffUserId] CHAR(26) NOT NULL,
    [publishedAt] DATETIME2,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FlowVersions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_FlowVersions_flowId_major_minor] UNIQUE NONCLUSTERED ([flowId],[major],[minor])
);

-- CreateTable
CREATE TABLE [tenant_template].[FlowNodes] (
    [id] CHAR(26) NOT NULL,
    [flowVersionId] CHAR(26) NOT NULL,
    [key] VARCHAR(64) NOT NULL,
    [type] VARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [canvasX] INT NOT NULL,
    [canvasY] INT NOT NULL,
    [messageText] NVARCHAR(max),
    [quickActionSetKey] VARCHAR(64),
    [slotName] VARCHAR(64),
    [optionSourceKind] VARCHAR(24),
    [optionSourceRef] NVARCHAR(200),
    [staticOptionsJson] NVARCHAR(max),
    [toolBindingId] CHAR(26),
    [retryCount] TINYINT,
    [retryOnTimeout] BIT,
    [timeoutMs] INT,
    [onFailureNodeId] CHAR(26),
    [handoverReason] VARCHAR(24),
    [confidenceThreshold] DECIMAL(5,4),
    [conditionExpression] NVARCHAR(1000),
    [requiredAssurance] VARCHAR(32),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FlowNodes_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_FlowNodes_flowVersionId_key] UNIQUE NONCLUSTERED ([flowVersionId],[key])
);

-- CreateTable
CREATE TABLE [tenant_template].[FlowEdges] (
    [id] CHAR(26) NOT NULL,
    [flowVersionId] CHAR(26) NOT NULL,
    [fromNodeId] CHAR(26) NOT NULL,
    [toNodeId] CHAR(26) NOT NULL,
    [label] NVARCHAR(120),
    [ordinal] SMALLINT NOT NULL,
    [conditionExpression] NVARCHAR(1000),
    [isDefaultBranch] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FlowEdges_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_FlowEdges_from_ordinal] UNIQUE NONCLUSTERED ([flowVersionId],[fromNodeId],[ordinal])
);

-- CreateTable
CREATE TABLE [tenant_template].[EscalationTickets] (
    [id] CHAR(26) NOT NULL,
    [conversationId] CHAR(26) NOT NULL,
    [topic] NVARCHAR(200) NOT NULL,
    [topicKey] VARCHAR(32) NOT NULL,
    [channelKey] VARCHAR(24) NOT NULL,
    [priority] VARCHAR(8) NOT NULL,
    [reason] VARCHAR(16) NOT NULL,
    [reasonDetail] NVARCHAR(500) NOT NULL,
    [originFlowNodeId] CHAR(26),
    [customerContextSummary] NVARCHAR(1000),
    [verificationState] VARCHAR(32) NOT NULL,
    [citizenIdentityId] CHAR(26),
    [pendingSlotName] VARCHAR(64),
    [contextSnapshotJson] NVARCHAR(max) NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [routedByRoutingRuleId] CHAR(26),
    [routeTargetTeamId] CHAR(26),
    [wasRequeued] BIT NOT NULL,
    [assignedStaffUserId] CHAR(26),
    [queuedAt] DATETIME2 NOT NULL,
    [assignedAt] DATETIME2,
    [firstResponseAt] DATETIME2,
    [resolvedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [EscalationTickets_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentPresence] (
    [staffUserId] CHAR(26) NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [statusChangedAt] DATETIME2 NOT NULL,
    [activeTicketCount] SMALLINT NOT NULL,
    [maxConcurrentTickets] SMALLINT NOT NULL,
    [lastHeartbeatAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentPresence_pkey] PRIMARY KEY CLUSTERED ([staffUserId])
);

-- CreateTable
CREATE TABLE [tenant_template].[RoutingRules] (
    [id] CHAR(26) NOT NULL,
    [ordinal] INT NOT NULL,
    [attribute] VARCHAR(16) NOT NULL,
    [operator] VARCHAR(4) NOT NULL,
    [value] NVARCHAR(64) NOT NULL,
    [targetKind] VARCHAR(16) NOT NULL,
    [targetTeamId] CHAR(26),
    [alertSupervisor] BIT NOT NULL,
    [isEnabled] BIT NOT NULL,
    [createdByStaffUserId] CHAR(26) NOT NULL,
    [updatedByStaffUserId] CHAR(26) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RoutingRules_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_RoutingRules_ordinal] UNIQUE NONCLUSTERED ([ordinal])
);

-- CreateTable
CREATE TABLE [tenant_template].[RoutingRuleTests] (
    [id] CHAR(26) NOT NULL,
    [sampleJson] NVARCHAR(max) NOT NULL,
    [firedRoutingRuleId] CHAR(26),
    [firedRuleOrdinal] INT,
    [resolvedTarget] NVARCHAR(200) NOT NULL,
    [fellToDefaultQueue] BIT NOT NULL,
    [ruleSetHash] CHAR(64) NOT NULL,
    [ranByStaffUserId] CHAR(26) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RoutingRuleTests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[CannedReplies] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [body] NVARCHAR(2000) NOT NULL,
    [teamId] CHAR(26),
    [topicKey] VARCHAR(32),
    [localeCode] VARCHAR(16) NOT NULL,
    [ordinal] SMALLINT NOT NULL,
    [isEnabled] BIT NOT NULL,
    [createdByStaffUserId] CHAR(26) NOT NULL,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CannedReplies_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[HandoverConfigs] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [HandoverConfigs_singletonKey_df] DEFAULT 1,
    [defaultQueueTeamId] CHAR(26) NOT NULL,
    [maxWaitSecondsBeforeRequeue] INT NOT NULL,
    [supervisorAlertTeamId] CHAR(26),
    [workingHoursProfileId] CHAR(26) NOT NULL,
    [noAgentAvailableMessage] NVARCHAR(500) NOT NULL,
    [offerEscalationOutsideHours] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [HandoverConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_HandoverConfigs_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[Channels] (
    [id] CHAR(26) NOT NULL,
    [key] VARCHAR(24) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [boundAgentId] CHAR(26),
    [state] VARCHAR(12) NOT NULL,
    [availability] VARCHAR(24) NOT NULL,
    [workingHoursProfileId] CHAR(26),
    [enabledAt] DATETIME2,
    [disabledAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Channels_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_Channels_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [tenant_template].[WorkingHoursProfiles] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [timezone] VARCHAR(64) NOT NULL CONSTRAINT [WorkingHoursProfiles_timezone_df] DEFAULT 'Asia/Dubai',
    [publicHolidayAutoSync] BIT NOT NULL,
    [assistantAvailable247] BIT NOT NULL,
    [noAgentAvailableMessage] NVARCHAR(500) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [WorkingHoursProfiles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_WorkingHoursProfiles_name] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [tenant_template].[WorkingHoursSlots] (
    [id] CHAR(26) NOT NULL,
    [workingHoursProfileId] CHAR(26) NOT NULL,
    [dayOfWeek] TINYINT NOT NULL,
    [opensAt] TIME NOT NULL,
    [closesAt] TIME NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [WorkingHoursSlots_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_WorkingHoursSlots_profile_day_opensAt] UNIQUE NONCLUSTERED ([workingHoursProfileId],[dayOfWeek],[opensAt])
);

-- CreateTable
CREATE TABLE [tenant_template].[PublicHolidays] (
    [id] CHAR(26) NOT NULL,
    [holidayDate] DATE NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [origin] VARCHAR(12) NOT NULL,
    [isObserved] BIT NOT NULL,
    [syncedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PublicHolidays_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PublicHolidays_holidayDate] UNIQUE NONCLUSTERED ([holidayDate])
);

-- CreateTable
CREATE TABLE [tenant_template].[WidgetConfigs] (
    [id] CHAR(26) NOT NULL,
    [channelId] CHAR(26) NOT NULL,
    [accentTokenKey] VARCHAR(64) NOT NULL,
    [launcherPosition] VARCHAR(16) NOT NULL,
    [defaultState] VARCHAR(12) NOT NULL,
    [disclaimerText] NVARCHAR(500) NOT NULL,
    [greetingText] NVARCHAR(1000) NOT NULL,
    [composerPlaceholder] NVARCHAR(160) NOT NULL,
    [showDisclaimerDismiss] BIT NOT NULL,
    [embedSnippetVersion] SMALLINT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [WidgetConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_WidgetConfigs_channelId] UNIQUE NONCLUSTERED ([channelId])
);

-- CreateTable
CREATE TABLE [tenant_template].[WidgetAllowedDomains] (
    [id] CHAR(26) NOT NULL,
    [channelId] CHAR(26) NOT NULL,
    [domain] NVARCHAR(253) NOT NULL,
    [addedByStaffUserId] CHAR(26) NOT NULL,
    [addedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [WidgetAllowedDomains_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_WidgetAllowedDomains_channelId_domain] UNIQUE NONCLUSTERED ([channelId],[domain])
);

-- CreateTable
CREATE TABLE [tenant_template].[WhatsAppConfigs] (
    [id] CHAR(26) NOT NULL,
    [channelId] CHAR(26) NOT NULL,
    [phoneNumber] VARCHAR(24) NOT NULL,
    [phoneNumberId] VARCHAR(64) NOT NULL,
    [wabaId] VARCHAR(64) NOT NULL,
    [bspProvider] VARCHAR(32) NOT NULL,
    [optInRequired] BIT NOT NULL,
    [sessionWindowHours] TINYINT NOT NULL CONSTRAINT [WhatsAppConfigs_sessionWindowHours_df] DEFAULT 24,
    [credentialSecretRef] NVARCHAR(200) NOT NULL,
    [webhookVerifySecretRef] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [WhatsAppConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_WhatsAppConfigs_channelId] UNIQUE NONCLUSTERED ([channelId]),
    CONSTRAINT [UQ_WhatsAppConfigs_phoneNumberId] UNIQUE NONCLUSTERED ([phoneNumberId])
);

-- CreateTable
CREATE TABLE [tenant_template].[MessageTemplates] (
    [id] CHAR(26) NOT NULL,
    [name] VARCHAR(120) NOT NULL,
    [channelKey] VARCHAR(24) NOT NULL,
    [category] VARCHAR(32) NOT NULL,
    [bodySample] NVARCHAR(2000) NOT NULL,
    [variablesJson] NVARCHAR(max),
    [localeCode] VARCHAR(16) NOT NULL,
    [approvalStatus] VARCHAR(12) NOT NULL,
    [bspTemplateId] VARCHAR(64),
    [submittedByStaffUserId] CHAR(26),
    [submittedAt] DATETIME2,
    [reviewedAt] DATETIME2,
    [rejectionReason] NVARCHAR(500),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MessageTemplates_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[Campaigns] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [messageTemplateId] CHAR(26) NOT NULL,
    [trigger] VARCHAR(32) NOT NULL,
    [triggerOffsetHours] INT,
    [audienceDefinitionJson] NVARCHAR(max) NOT NULL,
    [audienceLabel] NVARCHAR(200) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [respectQuietHours] BIT NOT NULL,
    [sentThisMonth] INT NOT NULL,
    [lastSentAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Campaigns_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_Campaigns_name] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [tenant_template].[CampaignSends] (
    [id] CHAR(26) NOT NULL,
    [campaignId] CHAR(26) NOT NULL,
    [messageTemplateId] CHAR(26) NOT NULL,
    [recipientHash] CHAR(64) NOT NULL,
    [citizenIdentityId] CHAR(26),
    [state] VARCHAR(12) NOT NULL,
    [suppressionReason] VARCHAR(32),
    [idempotencyKey] VARCHAR(120) NOT NULL,
    [bspMessageId] VARCHAR(120),
    [queuedAt] DATETIME2 NOT NULL,
    [sentAt] DATETIME2,
    [deliveredAt] DATETIME2,
    [failureCode] VARCHAR(64),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CampaignSends_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_CampaignSends_idempotencyKey] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[QuietHoursConfigs] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [QuietHoursConfigs_singletonKey_df] DEFAULT 1,
    [isEnabled] BIT NOT NULL,
    [startsAt] TIME NOT NULL,
    [endsAt] TIME NOT NULL,
    [timezone] VARCHAR(64) NOT NULL CONSTRAINT [QuietHoursConfigs_timezone_df] DEFAULT 'Asia/Dubai',
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [QuietHoursConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_QuietHoursConfigs_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[LocaleSettings] (
    [id] CHAR(26) NOT NULL,
    [localeCode] VARCHAR(16) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [voiceName] NVARCHAR(80),
    [translatedStringCount] INT NOT NULL,
    [totalStringCount] INT NOT NULL,
    [isFallback] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LocaleSettings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_LocaleSettings_localeCode] UNIQUE NONCLUSTERED ([localeCode])
);

-- CreateTable
CREATE TABLE [tenant_template].[TranslationStrings] (
    [id] CHAR(26) NOT NULL,
    [stringKey] VARCHAR(200) NOT NULL,
    [localeCode] VARCHAR(16) NOT NULL,
    [value] NVARCHAR(max),
    [state] VARCHAR(12) NOT NULL,
    [updatedByStaffUserId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TranslationStrings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_TranslationStrings_stringKey_localeCode] UNIQUE NONCLUSTERED ([stringKey],[localeCode])
);

-- CreateTable
CREATE TABLE [tenant_template].[VerificationProviders] (
    [id] CHAR(26) NOT NULL,
    [key] VARCHAR(32) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [providerType] VARCHAR(32) NOT NULL,
    [note] NVARCHAR(500),
    [isEnabled] BIT NOT NULL,
    [ordinal] TINYINT NOT NULL,
    [configJson] NVARCHAR(max),
    [credentialSecretRef] NVARCHAR(200),
    [providesAssurance] VARCHAR(32) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [VerificationProviders_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_VerificationProviders_key] UNIQUE NONCLUSTERED ([key]),
    CONSTRAINT [UQ_VerificationProviders_ordinal] UNIQUE NONCLUSTERED ([ordinal])
);

-- CreateTable
CREATE TABLE [tenant_template].[VerificationConfigs] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [VerificationConfigs_singletonKey_df] DEFAULT 1,
    [accountOwnershipCheckEnabled] BIT NOT NULL CONSTRAINT [VerificationConfigs_accountOwnershipCheckEnabled_df] DEFAULT 1,
    [ownershipCheckDisabledReason] NVARCHAR(500),
    [ownershipCheckLastChangedByStaffUserId] CHAR(26),
    [ownershipCheckLastChangedAt] DATETIME2,
    [otpLengthDigits] TINYINT NOT NULL,
    [otpTtlSeconds] INT NOT NULL,
    [otpMaxAttempts] TINYINT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [VerificationConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_VerificationConfigs_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[StepUpRules] (
    [id] CHAR(26) NOT NULL,
    [actionKey] VARCHAR(48) NOT NULL,
    [requiredAssurance] VARCHAR(32) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [ordinal] TINYINT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [StepUpRules_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_StepUpRules_actionKey] UNIQUE NONCLUSTERED ([actionKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[IdentityStitchingConfigs] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [IdentityStitchingConfigs_singletonKey_df] DEFAULT 1,
    [stitchAcrossChannels] BIT NOT NULL,
    [stitchingKey] VARCHAR(32) NOT NULL,
    [conversationMemoryScope] VARCHAR(32) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [IdentityStitchingConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_IdentityStitchingConfigs_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[CitizenIdentities] (
    [id] CHAR(26) NOT NULL,
    [assuranceLevel] VARCHAR(32) NOT NULL,
    [emiratesIdHash] CHAR(64),
    [mobileHash] CHAR(64),
    [displayNameMasked] NVARCHAR(120),
    [verifiedByProviderKey] VARCHAR(32),
    [verifiedAt] DATETIME2,
    [verificationExpiresAt] DATETIME2,
    [erasedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CitizenIdentities_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[IdentityLinks] (
    [id] CHAR(26) NOT NULL,
    [citizenIdentityId] CHAR(26) NOT NULL,
    [channelKey] VARCHAR(24) NOT NULL,
    [channelSubjectHash] CHAR(64) NOT NULL,
    [assuranceLevelAtLink] VARCHAR(32) NOT NULL,
    [stitchingKeyUsed] VARCHAR(32),
    [linkedAt] DATETIME2 NOT NULL,
    [unlinkedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [IdentityLinks_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[VerificationAttempts] (
    [id] CHAR(26) NOT NULL,
    [conversationId] CHAR(26),
    [citizenIdentityId] CHAR(26),
    [providerKey] VARCHAR(32) NOT NULL,
    [actionKey] VARCHAR(48),
    [requiredAssurance] VARCHAR(32),
    [result] VARCHAR(16) NOT NULL,
    [failureReason] VARCHAR(64),
    [attemptedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [VerificationAttempts_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[LinkedServiceAccounts] (
    [id] CHAR(26) NOT NULL,
    [citizenIdentityId] CHAR(26) NOT NULL,
    [providerKey] VARCHAR(32) NOT NULL,
    [accountNumberMasked] NVARCHAR(48) NOT NULL,
    [accountNumberHash] CHAR(64) NOT NULL,
    [ownershipVerified] BIT NOT NULL,
    [ownershipVerifiedAt] DATETIME2,
    [ownershipVerifiedVia] VARCHAR(32),
    [linkedAt] DATETIME2 NOT NULL,
    [unlinkedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LinkedServiceAccounts_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[PaymentGateways] (
    [id] CHAR(26) NOT NULL,
    [key] VARCHAR(32) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [methodsJson] NVARCHAR(max) NOT NULL,
    [mode] VARCHAR(12) NOT NULL,
    [credentialSecretRef] NVARCHAR(200) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [supportsRefunds] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PaymentGateways_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PaymentGateways_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [tenant_template].[ReceiptConfigs] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [ReceiptConfigs_singletonKey_df] DEFAULT 1,
    [sendInConversation] BIT NOT NULL,
    [emailPdfCopy] BIT NOT NULL,
    [allowRefundRequestsFromAssistant] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ReceiptConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_ReceiptConfigs_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[Transactions] (
    [id] CHAR(26) NOT NULL,
    [reference] VARCHAR(24) NOT NULL,
    [conversationId] CHAR(26),
    [citizenIdentityId] CHAR(26) NOT NULL,
    [paymentGatewayId] CHAR(26) NOT NULL,
    [serviceKey] VARCHAR(48) NOT NULL,
    [serviceLabel] NVARCHAR(200) NOT NULL,
    [linkedServiceAccountId] CHAR(26),
    [amountMinor] BIGINT NOT NULL,
    [currency] CHAR(3) NOT NULL CONSTRAINT [Transactions_currency_df] DEFAULT 'AED',
    [status] VARCHAR(20) NOT NULL,
    [gatewayReference] VARCHAR(120),
    [idempotencyKey] VARCHAR(120) NOT NULL,
    [assuranceLevelAtPayment] VARCHAR(32) NOT NULL,
    [initiatedAt] DATETIME2 NOT NULL,
    [settledAt] DATETIME2,
    [failureCode] VARCHAR(64),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Transactions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_Transactions_reference] UNIQUE NONCLUSTERED ([reference]),
    CONSTRAINT [UQ_Transactions_idempotencyKey] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[RefundRequests] (
    [id] CHAR(26) NOT NULL,
    [transactionId] CHAR(26) NOT NULL,
    [requestedByKind] VARCHAR(16) NOT NULL,
    [requestedByStaffUserId] CHAR(26),
    [reason] NVARCHAR(500) NOT NULL,
    [amountMinor] BIGINT NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [decidedByStaffUserId] CHAR(26),
    [decidedAt] DATETIME2,
    [decisionNote] NVARCHAR(500),
    [requestedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RefundRequests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[PaymentEvents] (
    [id] CHAR(26) NOT NULL,
    [transactionId] CHAR(26) NOT NULL,
    [kind] VARCHAR(32) NOT NULL,
    [gatewayEventId] VARCHAR(120) NOT NULL,
    [payloadRedactedJson] NVARCHAR(max) NOT NULL,
    [signatureVerified] BIT NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [receivedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PaymentEvents_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PaymentEvents_gatewayEventId] UNIQUE NONCLUSTERED ([gatewayEventId])
);

-- CreateTable
CREATE TABLE [tenant_template].[PolicySettings] (
    [id] CHAR(26) NOT NULL,
    [policyKey] VARCHAR(64) NOT NULL,
    [isEnabled] BIT NOT NULL,
    [valueJson] NVARCHAR(max),
    [updatedByStaffUserId] CHAR(26) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PolicySettings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PolicySettings_policyKey] UNIQUE NONCLUSTERED ([policyKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[PolicyOverrides] (
    [id] CHAR(26) NOT NULL,
    [agentId] CHAR(26) NOT NULL,
    [policyKey] VARCHAR(64) NOT NULL,
    [mode] VARCHAR(12) NOT NULL,
    [valueJson] NVARCHAR(max),
    [reason] NVARCHAR(500) NOT NULL,
    [createdByStaffUserId] CHAR(26) NOT NULL,
    [removedByStaffUserId] CHAR(26),
    [removedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PolicyOverrides_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[VersionDeployments] (
    [id] CHAR(26) NOT NULL,
    [agentId] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [environmentKey] VARCHAR(16) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [deployedAt] DATETIME2 NOT NULL,
    [deployedByStaffUserId] CHAR(26) NOT NULL,
    [supersededAt] DATETIME2,
    [promotionRequestId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [VersionDeployments_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[PromotionRequests] (
    [id] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [fromEnvironmentKey] VARCHAR(16) NOT NULL,
    [toEnvironmentKey] VARCHAR(16) NOT NULL,
    [requestedByStaffUserId] CHAR(26) NOT NULL,
    [requestedAt] DATETIME2 NOT NULL,
    [status] VARCHAR(20) NOT NULL,
    [gateEvaluationId] CHAR(26),
    [decidedByStaffUserId] CHAR(26),
    [decidedAt] DATETIME2,
    [decisionNote] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PromotionRequests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[AuditLogEntries] (
    [id] CHAR(26) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [actorStaffUserId] CHAR(26),
    [actorDisplayNameSnapshot] NVARCHAR(200) NOT NULL,
    [actorRoleSnapshot] NVARCHAR(120) NOT NULL,
    [action] VARCHAR(64) NOT NULL,
    [targetKind] VARCHAR(48) NOT NULL,
    [targetId] CHAR(26),
    [targetLabelSnapshot] NVARCHAR(300) NOT NULL,
    [environmentKey] VARCHAR(16),
    [beforeJson] NVARCHAR(max),
    [afterJson] NVARCHAR(max),
    [summary] NVARCHAR(500) NOT NULL,
    [correlationId] CHAR(26) NOT NULL,
    [requestId] CHAR(26),
    [ipHash] CHAR(64),
    [userAgentHash] CHAR(64),
    [sequenceNo] BIGINT NOT NULL IDENTITY(1,1),
    [prevHash] CHAR(64),
    [entryHash] CHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PK_AuditLogEntries] PRIMARY KEY NONCLUSTERED ([id]),
    CONSTRAINT [UQ_AuditLogEntries_sequenceNo] UNIQUE NONCLUSTERED ([sequenceNo])
);

-- CreateTable
CREATE TABLE [tenant_template].[PrivacyConfigs] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [PrivacyConfigs_singletonKey_df] DEFAULT 1,
    [consentLedgerEnabled] BIT NOT NULL,
    [honourErasureRequests] BIT NOT NULL,
    [transcriptRetention] VARCHAR(12) NOT NULL CONSTRAINT [PrivacyConfigs_transcriptRetention_df] DEFAULT 'Days90',
    [dataResidency] VARCHAR(32) NOT NULL,
    [updatedByStaffUserId] CHAR(26) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PrivacyConfigs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PrivacyConfigs_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[ConsentLedgerEntries] (
    [id] CHAR(26) NOT NULL,
    [subjectKind] VARCHAR(24) NOT NULL,
    [citizenIdentityId] CHAR(26),
    [subjectHash] CHAR(64) NOT NULL,
    [channelKey] VARCHAR(24) NOT NULL,
    [purpose] VARCHAR(48) NOT NULL,
    [action] VARCHAR(12) NOT NULL,
    [evidenceKind] VARCHAR(32) NOT NULL,
    [evidenceRef] NVARCHAR(300),
    [occurredAt] DATETIME2 NOT NULL,
    [sourceTurnId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ConsentLedgerEntries_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[ConsentStates] (
    [id] CHAR(26) NOT NULL,
    [subjectHash] CHAR(64) NOT NULL,
    [channelKey] VARCHAR(24) NOT NULL,
    [purpose] VARCHAR(48) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [lastLedgerEntryId] CHAR(26) NOT NULL,
    [effectiveAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ConsentStates_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_ConsentStates_subject_channel_purpose] UNIQUE NONCLUSTERED ([subjectHash],[channelKey],[purpose])
);

-- CreateTable
CREATE TABLE [tenant_template].[ErasureRequests] (
    [id] CHAR(26) NOT NULL,
    [subjectKind] VARCHAR(24) NOT NULL,
    [subjectHash] CHAR(64) NOT NULL,
    [citizenIdentityId] CHAR(26),
    [receivedVia] VARCHAR(32) NOT NULL,
    [requestedAt] DATETIME2 NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [rejectionReason] NVARCHAR(500),
    [completedAt] DATETIME2,
    [verificationEvidenceJson] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ErasureRequests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[ErasureTasks] (
    [id] CHAR(26) NOT NULL,
    [erasureRequestId] CHAR(26) NOT NULL,
    [store] VARCHAR(16) NOT NULL,
    [scopeDescription] NVARCHAR(500) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [affectedCount] INT,
    [verificationQuery] NVARCHAR(1000),
    [verifiedAt] DATETIME2,
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [error] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ErasureTasks_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_ErasureTasks_erasureRequestId_store] UNIQUE NONCLUSTERED ([erasureRequestId],[store])
);

-- CreateTable
CREATE TABLE [tenant_template].[RetentionSweepRuns] (
    [id] CHAR(26) NOT NULL,
    [scope] VARCHAR(24) NOT NULL,
    [retentionSetting] VARCHAR(12) NOT NULL,
    [cutoffAt] DATETIME2 NOT NULL,
    [conversationsPurged] INT NOT NULL,
    [turnsPurged] INT NOT NULL,
    [tracesPurged] INT NOT NULL,
    [derivedMemoryPurged] INT NOT NULL,
    [vectorsPurged] INT NOT NULL,
    [graphNodesPurged] INT NOT NULL,
    [redisKeysPurged] INT NOT NULL,
    [transactionsSkipped] INT NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [finishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RetentionSweepRuns_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[ServiceHealthSamples] (
    [id] CHAR(26) NOT NULL,
    [targetKind] VARCHAR(16) NOT NULL,
    [targetId] CHAR(26),
    [targetKey] VARCHAR(64),
    [displayName] NVARCHAR(200) NOT NULL,
    [windowStart] DATETIME2 NOT NULL,
    [windowEnd] DATETIME2 NOT NULL,
    [requestCount] INT NOT NULL,
    [p50LatencyMs] INT,
    [p95LatencyMs] INT NOT NULL,
    [p99LatencyMs] INT,
    [errorRate] DECIMAL(6,5) NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ServiceHealthSamples_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_ServiceHealthSamples_target_windowStart] UNIQUE NONCLUSTERED ([targetKind],[targetId],[targetKey],[windowStart])
);

-- CreateTable
CREATE TABLE [tenant_template].[GoldenSets] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [ownerTenantId] CHAR(26) NOT NULL,
    [description] NVARCHAR(1000),
    [kind] VARCHAR(24) NOT NULL,
    [localeCode] VARCHAR(16),
    [caseCount] INT NOT NULL,
    [lastScore] DECIMAL(5,4),
    [lastRunAt] DATETIME2,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GoldenSets_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[GoldenCases] (
    [id] CHAR(26) NOT NULL,
    [goldenSetId] CHAR(26) NOT NULL,
    [ordinal] INT NOT NULL,
    [prompt] NVARCHAR(max) NOT NULL,
    [expectedBehaviour] NVARCHAR(max) NOT NULL,
    [expectedToolCallsJson] NVARCHAR(max),
    [expectedCitationSourceIdsJson] NVARCHAR(max),
    [mustRefuse] BIT NOT NULL,
    [localeCode] VARCHAR(16) NOT NULL,
    [sourceConversationId] CHAR(26),
    [addedByStaffUserId] CHAR(26) NOT NULL,
    [addedAt] DATETIME2 NOT NULL,
    [isEnabled] BIT NOT NULL,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GoldenCases_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[RegressionRuns] (
    [id] CHAR(26) NOT NULL,
    [goldenSetId] CHAR(26) NOT NULL,
    [agentId] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [triggeredBy] VARCHAR(16) NOT NULL,
    [state] VARCHAR(12) NOT NULL,
    [accuracy] DECIMAL(5,4),
    [groundedness] DECIMAL(5,4),
    [toolAccuracy] DECIMAL(5,4),
    [localeParity] DECIMAL(5,4),
    [result] VARCHAR(12),
    [casesTotal] INT NOT NULL,
    [casesPassed] INT NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [finishedAt] DATETIME2,
    [ranByStaffUserId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RegressionRuns_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[RegressionCaseResults] (
    [id] CHAR(26) NOT NULL,
    [regressionRunId] CHAR(26) NOT NULL,
    [goldenCaseId] CHAR(26) NOT NULL,
    [passed] BIT NOT NULL,
    [accuracyScore] DECIMAL(5,4),
    [groundednessScore] DECIMAL(5,4),
    [toolAccuracyScore] DECIMAL(5,4),
    [actualResponse] NVARCHAR(max),
    [actualToolCallsJson] NVARCHAR(max),
    [failureReason] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RegressionCaseResults_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_RegressionCaseResults_run_case] UNIQUE NONCLUSTERED ([regressionRunId],[goldenCaseId])
);

-- CreateTable
CREATE TABLE [tenant_template].[PublishGates] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [PublishGates_singletonKey_df] DEFAULT 1,
    [blockOnSuiteFailure] BIT NOT NULL,
    [minAccuracy] DECIMAL(5,4) NOT NULL CONSTRAINT [PublishGates_minAccuracy_df] DEFAULT 0.8500,
    [minGroundedness] DECIMAL(5,4) NOT NULL CONSTRAINT [PublishGates_minGroundedness_df] DEFAULT 0.8000,
    [redTeamMustScore100] BIT NOT NULL,
    [blockOnBoundLocaleBelow100] BIT NOT NULL,
    [updatedByStaffUserId] CHAR(26) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PublishGates_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_PublishGates_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[GateEvaluations] (
    [id] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26) NOT NULL,
    [evaluatedAt] DATETIME2 NOT NULL,
    [passed] BIT NOT NULL,
    [gateSnapshotJson] NVARCHAR(max) NOT NULL,
    [blockingReasonsJson] NVARCHAR(max),
    [evaluatedForKind] VARCHAR(16) NOT NULL,
    [promotionRequestId] CHAR(26),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GateEvaluations_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[ConversationMetricsDaily] (
    [id] CHAR(26) NOT NULL,
    [metricDate] DATE NOT NULL,
    [channelKey] VARCHAR(24) NOT NULL,
    [agentId] CHAR(26),
    [conversationCount] INT NOT NULL,
    [containedCount] INT NOT NULL,
    [deflectedCount] INT NOT NULL,
    [escalatedCount] INT NOT NULL,
    [abandonedCount] INT NOT NULL,
    [turnCount] INT NOT NULL,
    [toolCallCount] INT NOT NULL,
    [toolErrorCount] INT NOT NULL,
    [thumbsUpCount] INT NOT NULL,
    [thumbsDownCount] INT NOT NULL,
    [avgFirstResponseMs] INT,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ConversationMetricsDaily_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_ConversationMetricsDaily_date_channel_agent] UNIQUE NONCLUSTERED ([metricDate],[channelKey],[agentId])
);

-- CreateTable
CREATE TABLE [tenant_template].[IntentMetricsDaily] (
    [id] CHAR(26) NOT NULL,
    [metricDate] DATE NOT NULL,
    [intentKey] VARCHAR(64) NOT NULL,
    [intentLabel] NVARCHAR(200) NOT NULL,
    [conversationCount] INT NOT NULL,
    [escalatedCount] INT NOT NULL,
    [resolvedCount] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [IntentMetricsDaily_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_IntentMetricsDaily_date_intent] UNIQUE NONCLUSTERED ([metricDate],[intentKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[AgentUsageDaily] (
    [id] CHAR(26) NOT NULL,
    [metricDate] DATE NOT NULL,
    [agentId] CHAR(26) NOT NULL,
    [agentVersionId] CHAR(26),
    [conversationCount] INT NOT NULL,
    [turnCount] INT NOT NULL,
    [toolCallCount] INT NOT NULL,
    [inputTokens] BIGINT NOT NULL,
    [outputTokens] BIGINT NOT NULL,
    [costMicroAed] BIGINT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentUsageDaily_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_AgentUsageDaily_date_agent_version] UNIQUE NONCLUSTERED ([metricDate],[agentId],[agentVersionId])
);

-- CreateTable
CREATE TABLE [tenant_template].[FeedbackIssues] (
    [id] CHAR(26) NOT NULL,
    [questionText] NVARCHAR(1000) NOT NULL,
    [clusterKey] CHAR(64) NOT NULL,
    [volume] INT NOT NULL,
    [rootCause] VARCHAR(24) NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [linkedKnowledgeSourceId] CHAR(26),
    [linkedFlowId] CHAR(26),
    [linkedGoldenCaseId] CHAR(26),
    [firstSeenAt] DATETIME2 NOT NULL,
    [lastSeenAt] DATETIME2 NOT NULL,
    [fixedByStaffUserId] CHAR(26),
    [fixedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FeedbackIssues_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_FeedbackIssues_clusterKey] UNIQUE NONCLUSTERED ([clusterKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[UnansweredQuestions] (
    [id] CHAR(26) NOT NULL,
    [questionText] NVARCHAR(1000) NOT NULL,
    [clusterKey] CHAR(64) NOT NULL,
    [askCount] INT NOT NULL,
    [firstAskedAt] DATETIME2 NOT NULL,
    [lastAskedAt] DATETIME2 NOT NULL,
    [status] VARCHAR(24) NOT NULL,
    [resolutionKnowledgeSourceId] CHAR(26),
    [resolutionFlowId] CHAR(26),
    [resolvedByStaffUserId] CHAR(26),
    [resolvedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [UnansweredQuestions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_UnansweredQuestions_clusterKey] UNIQUE NONCLUSTERED ([clusterKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[TranscriptExports] (
    [id] CHAR(26) NOT NULL,
    [requestedByStaffUserId] CHAR(26) NOT NULL,
    [filterJson] NVARCHAR(max) NOT NULL,
    [exportedRowCount] INT NOT NULL,
    [format] VARCHAR(8) NOT NULL,
    [redactionApplied] BIT NOT NULL,
    [storageRef] NVARCHAR(500),
    [expiresAt] DATETIME2 NOT NULL,
    [downloadedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TranscriptExports_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[TokenSets] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [kind] VARCHAR(16) NOT NULL,
    [mode] VARCHAR(8) NOT NULL,
    [schemaVersion] SMALLINT NOT NULL,
    [tokensJson] NVARCHAR(max) NOT NULL,
    [parentTokenSetId] CHAR(26),
    [contrastValidatedAt] DATETIME2,
    [contrastReportJson] NVARCHAR(max),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TokenSets_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[Skins] (
    [id] CHAR(26) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    [description] NVARCHAR(1000),
    [lightTokenSetId] CHAR(26) NOT NULL,
    [darkTokenSetId] CHAR(26) NOT NULL,
    [isSystem] BIT NOT NULL,
    [isTenantDefault] BIT NOT NULL,
    [status] VARCHAR(12) NOT NULL,
    [duplicatedFromSkinId] CHAR(26),
    [exportSchemaVersion] SMALLINT NOT NULL,
    [createdByStaffUserId] CHAR(26),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Skins_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [tenant_template].[TenantBrandings] (
    [id] CHAR(26) NOT NULL,
    [singletonKey] TINYINT NOT NULL CONSTRAINT [TenantBrandings_singletonKey_df] DEFAULT 1,
    [activeSkinId] CHAR(26) NOT NULL,
    [appTitle] NVARCHAR(120) NOT NULL,
    [logoLightAssetId] CHAR(26),
    [logoDarkAssetId] CHAR(26),
    [faviconAssetId] CHAR(26),
    [defaultMode] VARCHAR(8) NOT NULL,
    [defaultDirection] VARCHAR(3) NOT NULL,
    [density] VARCHAR(16) NOT NULL,
    [shadowDepth] VARCHAR(8) NOT NULL,
    [sidebarStyle] VARCHAR(16) NOT NULL,
    [whiteLabelEnabled] BIT NOT NULL,
    [updatedByStaffUserId] CHAR(26) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TenantBrandings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_TenantBrandings_singleton] UNIQUE NONCLUSTERED ([singletonKey])
);

-- CreateTable
CREATE TABLE [tenant_template].[BrandAssets] (
    [id] CHAR(26) NOT NULL,
    [kind] VARCHAR(16) NOT NULL,
    [fileName] NVARCHAR(260) NOT NULL,
    [mimeType] VARCHAR(120) NOT NULL,
    [byteSize] INT NOT NULL,
    [width] SMALLINT,
    [height] SMALLINT,
    [checksum] CHAR(64) NOT NULL,
    [storageRef] NVARCHAR(500) NOT NULL,
    [uploadedByStaffUserId] CHAR(26) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BrandAssets_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_BrandAssets_checksum_kind] UNIQUE NONCLUSTERED ([checksum],[kind])
);

-- CreateTable
CREATE TABLE [tenant_template].[UserThemePreferences] (
    [id] CHAR(26) NOT NULL,
    [staffUserId] CHAR(26) NOT NULL,
    [skinId] CHAR(26),
    [mode] VARCHAR(8),
    [density] VARCHAR(16),
    [direction] VARCHAR(3),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [UserThemePreferences_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_UserThemePreferences_staffUserId] UNIQUE NONCLUSTERED ([staffUserId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_TenantMigrations_state_tenantId] ON [platform].[TenantMigrations]([state], [tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_MigrationRuns_state_startedAt] ON [platform].[MigrationRuns]([state], [startedAt]);

-- CreateIndex
CREATE CLUSTERED INDEX [IX_PlatformAuditLogEntries_occurredAt_id] ON [platform].[PlatformAuditLogEntries]([occurredAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PlatformAuditLogEntries_actor_occurredAt] ON [platform].[PlatformAuditLogEntries]([actorStaffUserId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PlatformAuditLogEntries_action_occurredAt] ON [platform].[PlatformAuditLogEntries]([action], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PlatformAuditLogEntries_targetKind_targetId] ON [platform].[PlatformAuditLogEntries]([targetKind], [targetId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PlatformErasureRequests_status_requestedAt] ON [platform].[ErasureRequests]([status], [requestedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_StaffUsers_status] ON [platform].[StaffUsers]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_TenantMemberships_tenantId] ON [platform].[TenantMemberships]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_TokenSets_kind_mode] ON [platform].[TokenSets]([kind], [mode]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_GuideEntries_guideSectionId] ON [platform].[GuideEntries]([guideSectionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_GuideEntryTranslations_localeCode_state] ON [platform].[GuideEntryTranslations]([localeCode], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_OutboxEvents_aggregate] ON [tenant_template].[OutboxEvents]([aggregateKind], [aggregateId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_ReconciliationRuns_store_startedAt] ON [tenant_template].[ReconciliationRuns]([store], [startedAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_TeamMembers_staffUserId] ON [tenant_template].[TeamMembers]([staffUserId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_UserRoleAssignments_roleId] ON [tenant_template].[UserRoleAssignments]([roleId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_Conversations_startedAt_outcome] ON [tenant_template].[Conversations]([startedAt], [outcome]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_Conversations_channelKey_startedAt] ON [tenant_template].[Conversations]([channelKey], [startedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_ConversationTurns_agentVersionId] ON [tenant_template].[ConversationTurns]([agentVersionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_MessageFeedback_rating_createdAt] ON [tenant_template].[MessageFeedback]([rating], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_Agents_status] ON [tenant_template].[Agents]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_AgentVersions_agentId_status] ON [tenant_template].[AgentVersions]([agentId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_AgentVersionHistoryEntries_agentId_occurredAt] ON [tenant_template].[AgentVersionHistoryEntries]([agentId], [occurredAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_AgentSandboxRuns_agentVersionId_createdAt] ON [tenant_template].[AgentSandboxRuns]([agentVersionId], [createdAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_OrchestrationTraces_conversationId_startedAt] ON [tenant_template].[OrchestrationTraces]([conversationId], [startedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_OrchestrationTraces_routedAgentId_startedAt] ON [tenant_template].[OrchestrationTraces]([routedAgentId], [startedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_OrchestrationTraceSteps_toolBindingId_status] ON [tenant_template].[OrchestrationTraceSteps]([toolBindingId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_GroundingCitations_chunkId] ON [tenant_template].[GroundingCitations]([chunkId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_ToolBindings_agentVersionId] ON [tenant_template].[ToolBindings]([agentVersionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_CircuitBreakerEvents_configId_occurredAt] ON [tenant_template].[CircuitBreakerEvents]([circuitBreakerConfigId], [occurredAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_SourceDocuments_contentHash] ON [tenant_template].[SourceDocuments]([contentHash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_IngestionRuns_knowledgeSourceId_startedAt] ON [tenant_template].[IngestionRuns]([knowledgeSourceId], [startedAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_ReindexJobs_state_createdAt] ON [tenant_template].[ReindexJobs]([state], [createdAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_RetrievalPlaygroundRuns_createdAt] ON [tenant_template].[RetrievalPlaygroundRuns]([createdAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_SourceConflicts_status_detectedAt] ON [tenant_template].[SourceConflicts]([status], [detectedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_GraphEdgeRecords_from_type] ON [tenant_template].[GraphEdgeRecords]([fromNodeRecordId], [relationshipType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_GraphDuplicateCandidates_state_similarity] ON [tenant_template].[GraphDuplicateCandidates]([state], [similarity] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_GraphMergeDecisions_decidedAt] ON [tenant_template].[GraphMergeDecisions]([decidedAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_EscalationTickets_status_priority_queuedAt] ON [tenant_template].[EscalationTickets]([status], [priority], [queuedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_AgentPresence_status] ON [tenant_template].[AgentPresence]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_RoutingRuleTests_createdAt] ON [tenant_template].[RoutingRuleTests]([createdAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_MessageTemplates_approvalStatus] ON [tenant_template].[MessageTemplates]([approvalStatus]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_Campaigns_messageTemplateId] ON [tenant_template].[Campaigns]([messageTemplateId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_CampaignSends_campaignId_queuedAt] ON [tenant_template].[CampaignSends]([campaignId], [queuedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_TranslationStrings_localeCode_state] ON [tenant_template].[TranslationStrings]([localeCode], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_IdentityLinks_citizenIdentityId] ON [tenant_template].[IdentityLinks]([citizenIdentityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_VerificationAttempts_conversationId_attemptedAt] ON [tenant_template].[VerificationAttempts]([conversationId], [attemptedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_VerificationAttempts_result_attemptedAt] ON [tenant_template].[VerificationAttempts]([result], [attemptedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_LinkedServiceAccounts_accountNumberHash] ON [tenant_template].[LinkedServiceAccounts]([accountNumberHash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_Transactions_status_initiatedAt] ON [tenant_template].[Transactions]([status], [initiatedAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_Transactions_citizenIdentityId] ON [tenant_template].[Transactions]([citizenIdentityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_RefundRequests_status_requestedAt] ON [tenant_template].[RefundRequests]([status], [requestedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PaymentEvents_transactionId_occurredAt] ON [tenant_template].[PaymentEvents]([transactionId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PolicyOverrides_policyKey] ON [tenant_template].[PolicyOverrides]([policyKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_VersionDeployments_environmentKey_state] ON [tenant_template].[VersionDeployments]([environmentKey], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_PromotionRequests_status_requestedAt] ON [tenant_template].[PromotionRequests]([status], [requestedAt]);

-- CreateIndex
CREATE CLUSTERED INDEX [IX_AuditLogEntries_occurredAt_id] ON [tenant_template].[AuditLogEntries]([occurredAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_AuditLogEntries_actorStaffUserId_occurredAt] ON [tenant_template].[AuditLogEntries]([actorStaffUserId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_AuditLogEntries_targetKind_targetId] ON [tenant_template].[AuditLogEntries]([targetKind], [targetId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_AuditLogEntries_action_occurredAt] ON [tenant_template].[AuditLogEntries]([action], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_ConsentLedgerEntries_subjectHash_purpose_occurredAt] ON [tenant_template].[ConsentLedgerEntries]([subjectHash], [purpose], [occurredAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_ErasureRequests_status_requestedAt] ON [tenant_template].[ErasureRequests]([status], [requestedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_RetentionSweepRuns_startedAt] ON [tenant_template].[RetentionSweepRuns]([startedAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_ServiceHealthSamples_windowStart] ON [tenant_template].[ServiceHealthSamples]([windowStart] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_RegressionRuns_agentVersionId_startedAt] ON [tenant_template].[RegressionRuns]([agentVersionId], [startedAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_RegressionRuns_goldenSetId_startedAt] ON [tenant_template].[RegressionRuns]([goldenSetId], [startedAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_GateEvaluations_agentVersionId_evaluatedAt] ON [tenant_template].[GateEvaluations]([agentVersionId], [evaluatedAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_ConversationMetricsDaily_metricDate] ON [tenant_template].[ConversationMetricsDaily]([metricDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_IntentMetricsDaily_metricDate_conversationCount] ON [tenant_template].[IntentMetricsDaily]([metricDate], [conversationCount] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_AgentUsageDaily_agentId_metricDate] ON [tenant_template].[AgentUsageDaily]([agentId], [metricDate] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_FeedbackIssues_status_volume] ON [tenant_template].[FeedbackIssues]([status], [volume] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_UnansweredQuestions_status_askCount] ON [tenant_template].[UnansweredQuestions]([status], [askCount] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_TranscriptExports_createdAt] ON [tenant_template].[TranscriptExports]([createdAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IX_TokenSets_kind_mode] ON [tenant_template].[TokenSets]([kind], [mode]);

-- AddForeignKey
ALTER TABLE [platform].[TenantProvisioningSteps] ADD CONSTRAINT [TenantProvisioningSteps_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [platform].[Tenants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[TenantMigrations] ADD CONSTRAINT [TenantMigrations_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [platform].[Tenants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[TenantMigrations] ADD CONSTRAINT [TenantMigrations_migrationRunId_fkey] FOREIGN KEY ([migrationRunId]) REFERENCES [platform].[MigrationRuns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[MigrationRuns] ADD CONSTRAINT [MigrationRuns_initiatedByStaffUserId_fkey] FOREIGN KEY ([initiatedByStaffUserId]) REFERENCES [platform].[StaffUsers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[MigrationRuns] ADD CONSTRAINT [MigrationRuns_resumedFromRunId_fkey] FOREIGN KEY ([resumedFromRunId]) REFERENCES [platform].[MigrationRuns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[Environments] ADD CONSTRAINT [Environments_promotesToKey_fkey] FOREIGN KEY ([promotesToKey]) REFERENCES [platform].[Environments]([key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[OverridablePolicies] ADD CONSTRAINT [OverridablePolicies_policyKey_fkey] FOREIGN KEY ([policyKey]) REFERENCES [platform].[Policies]([policyKey]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[VectorCollectionRegistry] ADD CONSTRAINT [VectorCollectionRegistry_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [platform].[Tenants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[PlatformAuditLogEntries] ADD CONSTRAINT [PlatformAuditLogEntries_actorStaffUserId_fkey] FOREIGN KEY ([actorStaffUserId]) REFERENCES [platform].[StaffUsers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[PlatformAuditLogEntries] ADD CONSTRAINT [PlatformAuditLogEntries_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [platform].[Tenants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[ErasureRequests] ADD CONSTRAINT [ErasureRequests_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [platform].[Tenants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[StaffUsers] ADD CONSTRAINT [StaffUsers_homeTenantId_fkey] FOREIGN KEY ([homeTenantId]) REFERENCES [platform].[Tenants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[StaffUsers] ADD CONSTRAINT [StaffUsers_invitedByStaffUserId_fkey] FOREIGN KEY ([invitedByStaffUserId]) REFERENCES [platform].[StaffUsers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[StaffCredentials] ADD CONSTRAINT [StaffCredentials_staffUserId_fkey] FOREIGN KEY ([staffUserId]) REFERENCES [platform].[StaffUsers]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[TenantMemberships] ADD CONSTRAINT [TenantMemberships_staffUserId_fkey] FOREIGN KEY ([staffUserId]) REFERENCES [platform].[StaffUsers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[TenantMemberships] ADD CONSTRAINT [TenantMemberships_grantedByStaffUserId_fkey] FOREIGN KEY ([grantedByStaffUserId]) REFERENCES [platform].[StaffUsers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[TenantMemberships] ADD CONSTRAINT [TenantMemberships_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [platform].[Tenants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[TokenSets] ADD CONSTRAINT [TokenSets_parentTokenSetId_fkey] FOREIGN KEY ([parentTokenSetId]) REFERENCES [platform].[TokenSets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[Skins] ADD CONSTRAINT [Skins_lightTokenSetId_fkey] FOREIGN KEY ([lightTokenSetId]) REFERENCES [platform].[TokenSets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[Skins] ADD CONSTRAINT [Skins_darkTokenSetId_fkey] FOREIGN KEY ([darkTokenSetId]) REFERENCES [platform].[TokenSets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[Skins] ADD CONSTRAINT [Skins_duplicatedFromSkinId_fkey] FOREIGN KEY ([duplicatedFromSkinId]) REFERENCES [platform].[Skins]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[Skins] ADD CONSTRAINT [Skins_createdByStaffUserId_fkey] FOREIGN KEY ([createdByStaffUserId]) REFERENCES [platform].[StaffUsers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[GuideSections] ADD CONSTRAINT [GuideSections_parentSectionId_fkey] FOREIGN KEY ([parentSectionId]) REFERENCES [platform].[GuideSections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[GuideEntries] ADD CONSTRAINT [GuideEntries_guideSectionId_fkey] FOREIGN KEY ([guideSectionId]) REFERENCES [platform].[GuideSections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[GuideEntries] ADD CONSTRAINT [GuideEntries_updatedByStaffUserId_fkey] FOREIGN KEY ([updatedByStaffUserId]) REFERENCES [platform].[StaffUsers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[GuideScreenshots] ADD CONSTRAINT [GuideScreenshots_guideEntryId_fkey] FOREIGN KEY ([guideEntryId]) REFERENCES [platform].[GuideEntries]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[GuideScreenshots] ADD CONSTRAINT [GuideScreenshots_guideAssetId_fkey] FOREIGN KEY ([guideAssetId]) REFERENCES [platform].[GuideAssets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[GuideEntryTranslations] ADD CONSTRAINT [GuideEntryTranslations_guideEntryId_fkey] FOREIGN KEY ([guideEntryId]) REFERENCES [platform].[GuideEntries]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [platform].[GuideCoverageChecks] ADD CONSTRAINT [GuideCoverageChecks_guideEntryId_fkey] FOREIGN KEY ([guideEntryId]) REFERENCES [platform].[GuideEntries]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ReconciliationRuns] ADD CONSTRAINT [ReconciliationRuns_knowledgeSourceId_fkey] FOREIGN KEY ([knowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ReconciliationRuns] ADD CONSTRAINT [ReconciliationRuns_reindexJobId_fkey] FOREIGN KEY ([reindexJobId]) REFERENCES [tenant_template].[ReindexJobs]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[TeamMembers] ADD CONSTRAINT [TeamMembers_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [tenant_template].[Teams]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RolePermissions] ADD CONSTRAINT [RolePermissions_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [tenant_template].[Roles]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RolePermissions] ADD CONSTRAINT [RolePermissions_permissionKey_fkey] FOREIGN KEY ([permissionKey]) REFERENCES [platform].[Permissions]([key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[UserRoleAssignments] ADD CONSTRAINT [UserRoleAssignments_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [tenant_template].[Roles]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[UserRoleAssignments] ADD CONSTRAINT [UserRoleAssignments_scopeTeamId_fkey] FOREIGN KEY ([scopeTeamId]) REFERENCES [tenant_template].[Teams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Conversations] ADD CONSTRAINT [Conversations_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Conversations] ADD CONSTRAINT [Conversations_primaryAgentId_fkey] FOREIGN KEY ([primaryAgentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ConversationTurns] ADD CONSTRAINT [ConversationTurns_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [tenant_template].[Conversations]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ConversationTurns] ADD CONSTRAINT [ConversationTurns_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[MessageFeedback] ADD CONSTRAINT [MessageFeedback_turnId_fkey] FOREIGN KEY ([turnId]) REFERENCES [tenant_template].[ConversationTurns]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ConversationSlots] ADD CONSTRAINT [ConversationSlots_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [tenant_template].[Conversations]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[QuickActions] ADD CONSTRAINT [QuickActions_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Agents] ADD CONSTRAINT [Agents_currentVersionId_fkey] FOREIGN KEY ([currentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Agents] ADD CONSTRAINT [Agents_clonedFromAgentId_fkey] FOREIGN KEY ([clonedFromAgentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentVersions] ADD CONSTRAINT [AgentVersions_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentVersions] ADD CONSTRAINT [AgentVersions_clonedFromVersionId_fkey] FOREIGN KEY ([clonedFromVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentVersionHistoryEntries] ADD CONSTRAINT [AgentVersionHistoryEntries_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentVersionHistoryEntries] ADD CONSTRAINT [AgentVersionHistoryEntries_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentVersionHistoryEntries] ADD CONSTRAINT [AgentVersionHistoryEntries_fromVersionId_fkey] FOREIGN KEY ([fromVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentKnowledgeBindings] ADD CONSTRAINT [AgentKnowledgeBindings_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentKnowledgeBindings] ADD CONSTRAINT [AgentKnowledgeBindings_knowledgeCollectionId_fkey] FOREIGN KEY ([knowledgeCollectionId]) REFERENCES [tenant_template].[KnowledgeCollections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentFlowBindings] ADD CONSTRAINT [AgentFlowBindings_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentFlowBindings] ADD CONSTRAINT [AgentFlowBindings_flowId_fkey] FOREIGN KEY ([flowId]) REFERENCES [tenant_template].[Flows]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentFlowBindings] ADD CONSTRAINT [AgentFlowBindings_flowVersionId_fkey] FOREIGN KEY ([flowVersionId]) REFERENCES [tenant_template].[FlowVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentChannelBindings] ADD CONSTRAINT [AgentChannelBindings_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentLocaleBindings] ADD CONSTRAINT [AgentLocaleBindings_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentSandboxRuns] ADD CONSTRAINT [AgentSandboxRuns_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentWizardDrafts] ADD CONSTRAINT [AgentWizardDrafts_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentWizardDrafts] ADD CONSTRAINT [AgentWizardDrafts_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RouterConfigs] ADD CONSTRAINT [RouterConfigs_fallbackAgentId_fkey] FOREIGN KEY ([fallbackAgentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraces] ADD CONSTRAINT [OrchestrationTraces_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [tenant_template].[Conversations]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraces] ADD CONSTRAINT [OrchestrationTraces_turnId_fkey] FOREIGN KEY ([turnId]) REFERENCES [tenant_template].[ConversationTurns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraces] ADD CONSTRAINT [OrchestrationTraces_routedAgentId_fkey] FOREIGN KEY ([routedAgentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraces] ADD CONSTRAINT [OrchestrationTraces_routedAgentVersionId_fkey] FOREIGN KEY ([routedAgentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraceSteps] ADD CONSTRAINT [OrchestrationTraceSteps_traceId_fkey] FOREIGN KEY ([traceId]) REFERENCES [tenant_template].[OrchestrationTraces]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraceSteps] ADD CONSTRAINT [OrchestrationTraceSteps_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[OrchestrationTraceSteps] ADD CONSTRAINT [OrchestrationTraceSteps_toolBindingId_fkey] FOREIGN KEY ([toolBindingId]) REFERENCES [tenant_template].[ToolBindings]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GroundingCitations] ADD CONSTRAINT [GroundingCitations_traceId_fkey] FOREIGN KEY ([traceId]) REFERENCES [tenant_template].[OrchestrationTraces]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GroundingCitations] ADD CONSTRAINT [GroundingCitations_turnId_fkey] FOREIGN KEY ([turnId]) REFERENCES [tenant_template].[ConversationTurns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GroundingCitations] ADD CONSTRAINT [GroundingCitations_chunkId_fkey] FOREIGN KEY ([chunkId]) REFERENCES [tenant_template].[Chunks]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GroundingCitations] ADD CONSTRAINT [GroundingCitations_knowledgeSourceId_fkey] FOREIGN KEY ([knowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Skills] ADD CONSTRAINT [Skills_apiConnectorId_fkey] FOREIGN KEY ([apiConnectorId]) REFERENCES [tenant_template].[ApiConnectors]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Skills] ADD CONSTRAINT [Skills_mcpToolId_fkey] FOREIGN KEY ([mcpToolId]) REFERENCES [tenant_template].[McpTools]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Skills] ADD CONSTRAINT [Skills_rateLimitPolicyId_fkey] FOREIGN KEY ([rateLimitPolicyId]) REFERENCES [tenant_template].[RateLimitPolicies]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[McpTools] ADD CONSTRAINT [McpTools_mcpServerId_fkey] FOREIGN KEY ([mcpServerId]) REFERENCES [tenant_template].[McpServers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ApiConnectors] ADD CONSTRAINT [ApiConnectors_rateLimitPolicyId_fkey] FOREIGN KEY ([rateLimitPolicyId]) REFERENCES [tenant_template].[RateLimitPolicies]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ToolBindings] ADD CONSTRAINT [ToolBindings_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ToolBindings] ADD CONSTRAINT [ToolBindings_skillId_fkey] FOREIGN KEY ([skillId]) REFERENCES [tenant_template].[Skills]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ToolBindings] ADD CONSTRAINT [ToolBindings_mcpToolId_fkey] FOREIGN KEY ([mcpToolId]) REFERENCES [tenant_template].[McpTools]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ToolBindings] ADD CONSTRAINT [ToolBindings_apiConnectorId_fkey] FOREIGN KEY ([apiConnectorId]) REFERENCES [tenant_template].[ApiConnectors]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ToolBindings] ADD CONSTRAINT [ToolBindings_rateLimitPolicyId_fkey] FOREIGN KEY ([rateLimitPolicyId]) REFERENCES [tenant_template].[RateLimitPolicies]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[CircuitBreakerEvents] ADD CONSTRAINT [CircuitBreakerEvents_circuitBreakerConfigId_fkey] FOREIGN KEY ([circuitBreakerConfigId]) REFERENCES [tenant_template].[CircuitBreakerConfigs]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[KnowledgeCollections] ADD CONSTRAINT [KnowledgeCollections_retrievalConfigId_fkey] FOREIGN KEY ([retrievalConfigId]) REFERENCES [tenant_template].[RetrievalConfigs]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[KnowledgeSources] ADD CONSTRAINT [KnowledgeSources_knowledgeCollectionId_fkey] FOREIGN KEY ([knowledgeCollectionId]) REFERENCES [tenant_template].[KnowledgeCollections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[SourceDocuments] ADD CONSTRAINT [SourceDocuments_knowledgeSourceId_fkey] FOREIGN KEY ([knowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[SourceDocuments] ADD CONSTRAINT [SourceDocuments_supersededByDocumentId_fkey] FOREIGN KEY ([supersededByDocumentId]) REFERENCES [tenant_template].[SourceDocuments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Chunks] ADD CONSTRAINT [Chunks_sourceDocumentId_fkey] FOREIGN KEY ([sourceDocumentId]) REFERENCES [tenant_template].[SourceDocuments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Chunks] ADD CONSTRAINT [Chunks_knowledgeSourceId_fkey] FOREIGN KEY ([knowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Chunks] ADD CONSTRAINT [Chunks_knowledgeCollectionId_fkey] FOREIGN KEY ([knowledgeCollectionId]) REFERENCES [tenant_template].[KnowledgeCollections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[IngestionRuns] ADD CONSTRAINT [IngestionRuns_knowledgeSourceId_fkey] FOREIGN KEY ([knowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ReindexJobs] ADD CONSTRAINT [ReindexJobs_knowledgeSourceId_fkey] FOREIGN KEY ([knowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ReindexJobs] ADD CONSTRAINT [ReindexJobs_knowledgeCollectionId_fkey] FOREIGN KEY ([knowledgeCollectionId]) REFERENCES [tenant_template].[KnowledgeCollections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RetrievalConfigs] ADD CONSTRAINT [RetrievalConfigs_knowledgeCollectionId_fkey] FOREIGN KEY ([knowledgeCollectionId]) REFERENCES [tenant_template].[KnowledgeCollections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[SourceConflicts] ADD CONSTRAINT [SourceConflicts_graphNodeRecordId_fkey] FOREIGN KEY ([graphNodeRecordId]) REFERENCES [tenant_template].[GraphNodeRecords]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[SourceConflicts] ADD CONSTRAINT [SourceConflicts_sideAChunkId_fkey] FOREIGN KEY ([sideAChunkId]) REFERENCES [tenant_template].[Chunks]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[SourceConflicts] ADD CONSTRAINT [SourceConflicts_sideBChunkId_fkey] FOREIGN KEY ([sideBChunkId]) REFERENCES [tenant_template].[Chunks]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[SourceConflicts] ADD CONSTRAINT [SourceConflicts_sideAKnowledgeSourceId_fkey] FOREIGN KEY ([sideAKnowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[SourceConflicts] ADD CONSTRAINT [SourceConflicts_sideBKnowledgeSourceId_fkey] FOREIGN KEY ([sideBKnowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphNodeRecords] ADD CONSTRAINT [GraphNodeRecords_firstSeenChunkId_fkey] FOREIGN KEY ([firstSeenChunkId]) REFERENCES [tenant_template].[Chunks]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphNodeRecords] ADD CONSTRAINT [GraphNodeRecords_mergedIntoNodeRecordId_fkey] FOREIGN KEY ([mergedIntoNodeRecordId]) REFERENCES [tenant_template].[GraphNodeRecords]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphEdgeRecords] ADD CONSTRAINT [GraphEdgeRecords_fromNodeRecordId_fkey] FOREIGN KEY ([fromNodeRecordId]) REFERENCES [tenant_template].[GraphNodeRecords]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphEdgeRecords] ADD CONSTRAINT [GraphEdgeRecords_toNodeRecordId_fkey] FOREIGN KEY ([toNodeRecordId]) REFERENCES [tenant_template].[GraphNodeRecords]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphEdgeRecords] ADD CONSTRAINT [GraphEdgeRecords_evidenceChunkId_fkey] FOREIGN KEY ([evidenceChunkId]) REFERENCES [tenant_template].[Chunks]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphDuplicateCandidates] ADD CONSTRAINT [GraphDuplicateCandidates_leftNodeRecordId_fkey] FOREIGN KEY ([leftNodeRecordId]) REFERENCES [tenant_template].[GraphNodeRecords]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphDuplicateCandidates] ADD CONSTRAINT [GraphDuplicateCandidates_rightNodeRecordId_fkey] FOREIGN KEY ([rightNodeRecordId]) REFERENCES [tenant_template].[GraphNodeRecords]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphMergeDecisions] ADD CONSTRAINT [GraphMergeDecisions_graphDuplicateCandidateId_fkey] FOREIGN KEY ([graphDuplicateCandidateId]) REFERENCES [tenant_template].[GraphDuplicateCandidates]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphMergeDecisions] ADD CONSTRAINT [GraphMergeDecisions_survivingNodeRecordId_fkey] FOREIGN KEY ([survivingNodeRecordId]) REFERENCES [tenant_template].[GraphNodeRecords]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphMergeDecisions] ADD CONSTRAINT [GraphMergeDecisions_absorbedNodeRecordId_fkey] FOREIGN KEY ([absorbedNodeRecordId]) REFERENCES [tenant_template].[GraphNodeRecords]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GraphMergeDecisions] ADD CONSTRAINT [GraphMergeDecisions_reindexJobId_fkey] FOREIGN KEY ([reindexJobId]) REFERENCES [tenant_template].[ReindexJobs]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Flows] ADD CONSTRAINT [Flows_currentVersionId_fkey] FOREIGN KEY ([currentVersionId]) REFERENCES [tenant_template].[FlowVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowVersions] ADD CONSTRAINT [FlowVersions_flowId_fkey] FOREIGN KEY ([flowId]) REFERENCES [tenant_template].[Flows]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowVersions] ADD CONSTRAINT [FlowVersions_entryNodeId_fkey] FOREIGN KEY ([entryNodeId]) REFERENCES [tenant_template].[FlowNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowVersions] ADD CONSTRAINT [FlowVersions_escapeNodeId_fkey] FOREIGN KEY ([escapeNodeId]) REFERENCES [tenant_template].[FlowNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowNodes] ADD CONSTRAINT [FlowNodes_flowVersionId_fkey] FOREIGN KEY ([flowVersionId]) REFERENCES [tenant_template].[FlowVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowNodes] ADD CONSTRAINT [FlowNodes_toolBindingId_fkey] FOREIGN KEY ([toolBindingId]) REFERENCES [tenant_template].[ToolBindings]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowNodes] ADD CONSTRAINT [FlowNodes_onFailureNodeId_fkey] FOREIGN KEY ([onFailureNodeId]) REFERENCES [tenant_template].[FlowNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowEdges] ADD CONSTRAINT [FlowEdges_flowVersionId_fkey] FOREIGN KEY ([flowVersionId]) REFERENCES [tenant_template].[FlowVersions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowEdges] ADD CONSTRAINT [FlowEdges_fromNodeId_fkey] FOREIGN KEY ([fromNodeId]) REFERENCES [tenant_template].[FlowNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FlowEdges] ADD CONSTRAINT [FlowEdges_toNodeId_fkey] FOREIGN KEY ([toNodeId]) REFERENCES [tenant_template].[FlowNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[EscalationTickets] ADD CONSTRAINT [EscalationTickets_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [tenant_template].[Conversations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[EscalationTickets] ADD CONSTRAINT [EscalationTickets_originFlowNodeId_fkey] FOREIGN KEY ([originFlowNodeId]) REFERENCES [tenant_template].[FlowNodes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[EscalationTickets] ADD CONSTRAINT [EscalationTickets_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[EscalationTickets] ADD CONSTRAINT [EscalationTickets_routedByRoutingRuleId_fkey] FOREIGN KEY ([routedByRoutingRuleId]) REFERENCES [tenant_template].[RoutingRules]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[EscalationTickets] ADD CONSTRAINT [EscalationTickets_routeTargetTeamId_fkey] FOREIGN KEY ([routeTargetTeamId]) REFERENCES [tenant_template].[Teams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RoutingRules] ADD CONSTRAINT [RoutingRules_targetTeamId_fkey] FOREIGN KEY ([targetTeamId]) REFERENCES [tenant_template].[Teams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RoutingRuleTests] ADD CONSTRAINT [RoutingRuleTests_firedRoutingRuleId_fkey] FOREIGN KEY ([firedRoutingRuleId]) REFERENCES [tenant_template].[RoutingRules]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[CannedReplies] ADD CONSTRAINT [CannedReplies_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [tenant_template].[Teams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[HandoverConfigs] ADD CONSTRAINT [HandoverConfigs_defaultQueueTeamId_fkey] FOREIGN KEY ([defaultQueueTeamId]) REFERENCES [tenant_template].[Teams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[HandoverConfigs] ADD CONSTRAINT [HandoverConfigs_supervisorAlertTeamId_fkey] FOREIGN KEY ([supervisorAlertTeamId]) REFERENCES [tenant_template].[Teams]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[HandoverConfigs] ADD CONSTRAINT [HandoverConfigs_workingHoursProfileId_fkey] FOREIGN KEY ([workingHoursProfileId]) REFERENCES [tenant_template].[WorkingHoursProfiles]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Channels] ADD CONSTRAINT [Channels_boundAgentId_fkey] FOREIGN KEY ([boundAgentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Channels] ADD CONSTRAINT [Channels_workingHoursProfileId_fkey] FOREIGN KEY ([workingHoursProfileId]) REFERENCES [tenant_template].[WorkingHoursProfiles]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[WorkingHoursSlots] ADD CONSTRAINT [WorkingHoursSlots_workingHoursProfileId_fkey] FOREIGN KEY ([workingHoursProfileId]) REFERENCES [tenant_template].[WorkingHoursProfiles]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[WidgetConfigs] ADD CONSTRAINT [WidgetConfigs_channelId_fkey] FOREIGN KEY ([channelId]) REFERENCES [tenant_template].[Channels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[WidgetAllowedDomains] ADD CONSTRAINT [WidgetAllowedDomains_channelId_fkey] FOREIGN KEY ([channelId]) REFERENCES [tenant_template].[Channels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[WhatsAppConfigs] ADD CONSTRAINT [WhatsAppConfigs_channelId_fkey] FOREIGN KEY ([channelId]) REFERENCES [tenant_template].[Channels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Campaigns] ADD CONSTRAINT [Campaigns_messageTemplateId_fkey] FOREIGN KEY ([messageTemplateId]) REFERENCES [tenant_template].[MessageTemplates]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[CampaignSends] ADD CONSTRAINT [CampaignSends_campaignId_fkey] FOREIGN KEY ([campaignId]) REFERENCES [tenant_template].[Campaigns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[CampaignSends] ADD CONSTRAINT [CampaignSends_messageTemplateId_fkey] FOREIGN KEY ([messageTemplateId]) REFERENCES [tenant_template].[MessageTemplates]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[CampaignSends] ADD CONSTRAINT [CampaignSends_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[LocaleSettings] ADD CONSTRAINT [LocaleSettings_localeCode_fkey] FOREIGN KEY ([localeCode]) REFERENCES [platform].[Locales]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[IdentityLinks] ADD CONSTRAINT [IdentityLinks_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[VerificationAttempts] ADD CONSTRAINT [VerificationAttempts_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [tenant_template].[Conversations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[VerificationAttempts] ADD CONSTRAINT [VerificationAttempts_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[LinkedServiceAccounts] ADD CONSTRAINT [LinkedServiceAccounts_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Transactions] ADD CONSTRAINT [Transactions_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [tenant_template].[Conversations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Transactions] ADD CONSTRAINT [Transactions_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Transactions] ADD CONSTRAINT [Transactions_paymentGatewayId_fkey] FOREIGN KEY ([paymentGatewayId]) REFERENCES [tenant_template].[PaymentGateways]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Transactions] ADD CONSTRAINT [Transactions_linkedServiceAccountId_fkey] FOREIGN KEY ([linkedServiceAccountId]) REFERENCES [tenant_template].[LinkedServiceAccounts]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RefundRequests] ADD CONSTRAINT [RefundRequests_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [tenant_template].[Transactions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PaymentEvents] ADD CONSTRAINT [PaymentEvents_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [tenant_template].[Transactions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PolicySettings] ADD CONSTRAINT [PolicySettings_policyKey_fkey] FOREIGN KEY ([policyKey]) REFERENCES [platform].[OverridablePolicies]([policyKey]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PolicyOverrides] ADD CONSTRAINT [PolicyOverrides_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PolicyOverrides] ADD CONSTRAINT [PolicyOverrides_policyKey_fkey] FOREIGN KEY ([policyKey]) REFERENCES [platform].[OverridablePolicies]([policyKey]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[VersionDeployments] ADD CONSTRAINT [VersionDeployments_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[VersionDeployments] ADD CONSTRAINT [VersionDeployments_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[VersionDeployments] ADD CONSTRAINT [VersionDeployments_environmentKey_fkey] FOREIGN KEY ([environmentKey]) REFERENCES [platform].[Environments]([key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[VersionDeployments] ADD CONSTRAINT [VersionDeployments_promotionRequestId_fkey] FOREIGN KEY ([promotionRequestId]) REFERENCES [tenant_template].[PromotionRequests]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PromotionRequests] ADD CONSTRAINT [PromotionRequests_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[PromotionRequests] ADD CONSTRAINT [PromotionRequests_gateEvaluationId_fkey] FOREIGN KEY ([gateEvaluationId]) REFERENCES [tenant_template].[GateEvaluations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ConsentLedgerEntries] ADD CONSTRAINT [ConsentLedgerEntries_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ConsentLedgerEntries] ADD CONSTRAINT [ConsentLedgerEntries_sourceTurnId_fkey] FOREIGN KEY ([sourceTurnId]) REFERENCES [tenant_template].[ConversationTurns]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ConsentStates] ADD CONSTRAINT [ConsentStates_lastLedgerEntryId_fkey] FOREIGN KEY ([lastLedgerEntryId]) REFERENCES [tenant_template].[ConsentLedgerEntries]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ErasureRequests] ADD CONSTRAINT [ErasureRequests_citizenIdentityId_fkey] FOREIGN KEY ([citizenIdentityId]) REFERENCES [tenant_template].[CitizenIdentities]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ErasureTasks] ADD CONSTRAINT [ErasureTasks_erasureRequestId_fkey] FOREIGN KEY ([erasureRequestId]) REFERENCES [tenant_template].[ErasureRequests]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GoldenCases] ADD CONSTRAINT [GoldenCases_goldenSetId_fkey] FOREIGN KEY ([goldenSetId]) REFERENCES [tenant_template].[GoldenSets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GoldenCases] ADD CONSTRAINT [GoldenCases_sourceConversationId_fkey] FOREIGN KEY ([sourceConversationId]) REFERENCES [tenant_template].[Conversations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RegressionRuns] ADD CONSTRAINT [RegressionRuns_goldenSetId_fkey] FOREIGN KEY ([goldenSetId]) REFERENCES [tenant_template].[GoldenSets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RegressionRuns] ADD CONSTRAINT [RegressionRuns_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RegressionRuns] ADD CONSTRAINT [RegressionRuns_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RegressionCaseResults] ADD CONSTRAINT [RegressionCaseResults_regressionRunId_fkey] FOREIGN KEY ([regressionRunId]) REFERENCES [tenant_template].[RegressionRuns]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[RegressionCaseResults] ADD CONSTRAINT [RegressionCaseResults_goldenCaseId_fkey] FOREIGN KEY ([goldenCaseId]) REFERENCES [tenant_template].[GoldenCases]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GateEvaluations] ADD CONSTRAINT [GateEvaluations_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[GateEvaluations] ADD CONSTRAINT [GateEvaluations_promotionRequestId_fkey] FOREIGN KEY ([promotionRequestId]) REFERENCES [tenant_template].[PromotionRequests]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[ConversationMetricsDaily] ADD CONSTRAINT [ConversationMetricsDaily_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentUsageDaily] ADD CONSTRAINT [AgentUsageDaily_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [tenant_template].[Agents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[AgentUsageDaily] ADD CONSTRAINT [AgentUsageDaily_agentVersionId_fkey] FOREIGN KEY ([agentVersionId]) REFERENCES [tenant_template].[AgentVersions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FeedbackIssues] ADD CONSTRAINT [FeedbackIssues_linkedKnowledgeSourceId_fkey] FOREIGN KEY ([linkedKnowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FeedbackIssues] ADD CONSTRAINT [FeedbackIssues_linkedFlowId_fkey] FOREIGN KEY ([linkedFlowId]) REFERENCES [tenant_template].[Flows]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[FeedbackIssues] ADD CONSTRAINT [FeedbackIssues_linkedGoldenCaseId_fkey] FOREIGN KEY ([linkedGoldenCaseId]) REFERENCES [tenant_template].[GoldenCases]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[UnansweredQuestions] ADD CONSTRAINT [UnansweredQuestions_resolutionKnowledgeSourceId_fkey] FOREIGN KEY ([resolutionKnowledgeSourceId]) REFERENCES [tenant_template].[KnowledgeSources]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[UnansweredQuestions] ADD CONSTRAINT [UnansweredQuestions_resolutionFlowId_fkey] FOREIGN KEY ([resolutionFlowId]) REFERENCES [tenant_template].[Flows]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[TokenSets] ADD CONSTRAINT [TokenSets_parentTokenSetId_fkey] FOREIGN KEY ([parentTokenSetId]) REFERENCES [tenant_template].[TokenSets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Skins] ADD CONSTRAINT [Skins_lightTokenSetId_fkey] FOREIGN KEY ([lightTokenSetId]) REFERENCES [tenant_template].[TokenSets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Skins] ADD CONSTRAINT [Skins_darkTokenSetId_fkey] FOREIGN KEY ([darkTokenSetId]) REFERENCES [tenant_template].[TokenSets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[Skins] ADD CONSTRAINT [Skins_duplicatedFromSkinId_fkey] FOREIGN KEY ([duplicatedFromSkinId]) REFERENCES [tenant_template].[Skins]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[TenantBrandings] ADD CONSTRAINT [TenantBrandings_activeSkinId_fkey] FOREIGN KEY ([activeSkinId]) REFERENCES [tenant_template].[Skins]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[TenantBrandings] ADD CONSTRAINT [TenantBrandings_logoLightAssetId_fkey] FOREIGN KEY ([logoLightAssetId]) REFERENCES [tenant_template].[BrandAssets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[TenantBrandings] ADD CONSTRAINT [TenantBrandings_logoDarkAssetId_fkey] FOREIGN KEY ([logoDarkAssetId]) REFERENCES [tenant_template].[BrandAssets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[TenantBrandings] ADD CONSTRAINT [TenantBrandings_faviconAssetId_fkey] FOREIGN KEY ([faviconAssetId]) REFERENCES [tenant_template].[BrandAssets]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [tenant_template].[UserThemePreferences] ADD CONSTRAINT [UserThemePreferences_skinId_fkey] FOREIGN KEY ([skinId]) REFERENCES [tenant_template].[Skins]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
