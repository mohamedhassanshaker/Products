/** Public API of the sessions module. */
export { SessionsModule } from './sessions.module';
export { SESSION_REPOSITORY } from './domain/ports';
export type { SessionRepositoryPort } from './domain/ports';
export type { SessionRecord, SessionStatus, SummaryStatus, ProviderStackSnapshot, ResidencySnapshot } from './domain/session';
export { nextStatus, isTerminalStatus } from './domain/session-status';
export type { SessionEvent } from './domain/session-status';
export {
  UTTERANCE_REPOSITORY,
  HOP_REPOSITORY,
  ALERT_REPOSITORY,
  FEEDBACK_REPOSITORY,
} from './domain/telemetry-ports';
export type {
  UtteranceRepositoryPort,
  UtteranceRow,
  HopRepositoryPort,
  HopRow,
  AlertRepositoryPort,
  AlertEventRow,
  AlertKind,
  FeedbackRepositoryPort,
} from './domain/telemetry-ports';
export { GetPreflightUseCase } from './application/get-preflight.use-case';
export { IssueConversationTokenUseCase } from './application/issue-conversation-token.use-case';
export { EndSessionUseCase } from './application/end-session.use-case';
export { ApplySessionEventUseCase } from './application/apply-session-event.use-case';
export { SweepAbandonedSessionsUseCase, ABANDON_AFTER_MS } from './application/sweep-abandoned-sessions.use-case';
export { GetRuntimeConfigUseCase } from './application/get-runtime-config.use-case';
export { RecordUtterancesUseCase } from './application/record-utterances.use-case';
export { RecordHopsUseCase } from './application/record-hops.use-case';
export { SetSessionSummaryUseCase } from './application/set-session-summary.use-case';
export { RecordAlertUseCase } from './application/record-alert.use-case';
export { GetSessionSummaryUseCase } from './application/get-session-summary.use-case';
export { SubmitFeedbackUseCase } from './application/submit-feedback.use-case';
