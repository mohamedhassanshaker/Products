import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants';
import { DeploymentConfigModule } from '../deployment-config';
import { ProvidersModule } from '../providers';
import { ToolsModule } from '../tools';
import { SkillsModule } from '../skills';
import { TransportModule } from '../transport';
import { SESSION_REPOSITORY, RESIDENCY_SNAPSHOT_READER } from './domain/ports';
import { UTTERANCE_REPOSITORY, HOP_REPOSITORY, ALERT_REPOSITORY, FEEDBACK_REPOSITORY } from './domain/telemetry-ports';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaResidencySnapshotReader } from './infrastructure/prisma-residency-snapshot.reader';
import { PrismaUtteranceRepository } from './infrastructure/prisma-utterance.repository';
import { PrismaHopRepository } from './infrastructure/prisma-hop.repository';
import { PrismaAlertRepository } from './infrastructure/prisma-alert.repository';
import { PrismaFeedbackRepository } from './infrastructure/prisma-feedback.repository';
import { GetPreflightUseCase } from './application/get-preflight.use-case';
import { IssueConversationTokenUseCase } from './application/issue-conversation-token.use-case';
import { EndSessionUseCase } from './application/end-session.use-case';
import { ApplySessionEventUseCase } from './application/apply-session-event.use-case';
import { SweepAbandonedSessionsUseCase } from './application/sweep-abandoned-sessions.use-case';
import { GetRuntimeConfigUseCase } from './application/get-runtime-config.use-case';
import { RecordUtterancesUseCase } from './application/record-utterances.use-case';
import { RecordHopsUseCase } from './application/record-hops.use-case';
import { SetSessionSummaryUseCase } from './application/set-session-summary.use-case';
import { RecordAlertUseCase } from './application/record-alert.use-case';
import { GetSessionSummaryUseCase } from './application/get-session-summary.use-case';
import { SubmitFeedbackUseCase } from './application/submit-feedback.use-case';

/**
 * Sessions bounded context (FR-TRANSPORT-4, FR-AUTH-4, FR-CALL-1/2, and —
 * from Phase 4 — the agent-facing telemetry write path FR-STT/LLM/TTS-4,
 * FR-CALL-4, FR-ALERT-*). Owns the `Session` row lifecycle end to end;
 * depends one-directionally on `TenantsModule` (access/pause checks),
 * `DeploymentConfigModule` (completeness gate + provider-stack snapshot +
 * runtime-config resolution), `ProvidersModule` (credential endpoint
 * resolution for `GetRuntimeConfigUseCase`), `TransportModule`
 * (LiveKit room/token/dispatch capability), and — QA fix, phase4-agent-python
 * D-2 — `ToolsModule` (resolves `agent.tools[]`'s bare `api_ref` references
 * into full `ToolDefinition` rows for `GetRuntimeConfigUseCase`'s
 * `tool_definitions` field) and — Phase 13, BL-049/050/051 — `SkillsModule`
 * (resolves `skills[]`/any `skill`-type graph node's `"latest"` version
 * reference into a concrete published version + description, once per
 * session, for the new `skill_summaries` field) — never the reverse, so
 * there is no module cycle. Has no `interface` layer of its own: `public` and
 * `internal` compose these use cases directly (LLD §3.1 "interface-only
 * module" shape).
 *
 * `TranscriptUtterance`/`LatencyHop`/`AlertEvent` write-path repositories
 * are owned here for this phase (see `domain/telemetry-ports.ts`'s
 * docstring) since `sessions` is the only consumer today; their *read*
 * side belongs to whichever Phase 7 module needs it (session-logs,
 * dashboard, alerts).
 */
@Module({
  imports: [TenantsModule, DeploymentConfigModule, ProvidersModule, TransportModule, ToolsModule, SkillsModule],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: RESIDENCY_SNAPSHOT_READER, useClass: PrismaResidencySnapshotReader },
    { provide: UTTERANCE_REPOSITORY, useClass: PrismaUtteranceRepository },
    { provide: HOP_REPOSITORY, useClass: PrismaHopRepository },
    { provide: ALERT_REPOSITORY, useClass: PrismaAlertRepository },
    { provide: FEEDBACK_REPOSITORY, useClass: PrismaFeedbackRepository },
    GetPreflightUseCase,
    IssueConversationTokenUseCase,
    EndSessionUseCase,
    ApplySessionEventUseCase,
    SweepAbandonedSessionsUseCase,
    GetRuntimeConfigUseCase,
    RecordUtterancesUseCase,
    RecordHopsUseCase,
    SetSessionSummaryUseCase,
    RecordAlertUseCase,
    GetSessionSummaryUseCase,
    SubmitFeedbackUseCase,
  ],
  exports: [
    SESSION_REPOSITORY,
    UTTERANCE_REPOSITORY,
    HOP_REPOSITORY,
    ALERT_REPOSITORY,
    FEEDBACK_REPOSITORY,
    GetPreflightUseCase,
    IssueConversationTokenUseCase,
    EndSessionUseCase,
    ApplySessionEventUseCase,
    SweepAbandonedSessionsUseCase,
    GetRuntimeConfigUseCase,
    RecordUtterancesUseCase,
    RecordHopsUseCase,
    SetSessionSummaryUseCase,
    RecordAlertUseCase,
    GetSessionSummaryUseCase,
    SubmitFeedbackUseCase,
  ],
})
export class SessionsModule {}
