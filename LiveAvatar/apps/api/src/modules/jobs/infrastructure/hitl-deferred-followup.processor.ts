import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { HITL_DECISION_REPOSITORY, HITL_GATE_REPOSITORY, type HitlDecisionRepositoryPort, type HitlGateRepositoryPort } from '../../hitl';
import { TOOL_DEFINITION_REPOSITORY, TOOL_INVOKER, type ToolDefinitionRepositoryPort, type ToolInvokerPort } from '../../tools';
import { NOTIFICATION_PORT, type NotificationPort } from '../../../common/notifications/notification.port';
import { HITL_DEFERRED_FOLLOWUP_QUEUE } from '../domain/queue-names';

/**
 * BullMQ worker for the `hitl-deferred-followup` on-demand job (Phase 14,
 * BL-056; `ARCHITECTURE_NOTES.md` §6.3) — the one genuinely new execution
 * capability this phase adds: running a tool call **out of band**, after
 * the caller who triggered it has already left the session. Reuses
 * `TOOL_INVOKER` (`ToolsModule`'s existing NestJS-native `ToolExecutor`
 * re-implementation, already exported for exactly this kind of "invoke a
 * tool outside the live pipeline" reuse — see that port's own doc comment)
 * rather than building a second HTTP-call implementation.
 */
@Processor(HITL_DEFERRED_FOLLOWUP_QUEUE)
export class HitlDeferredFollowupProcessor extends WorkerHost {
  private readonly logger = new Logger(HitlDeferredFollowupProcessor.name);

  constructor(
    @Inject(HITL_DECISION_REPOSITORY) private readonly decisions: HitlDecisionRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly gates: HitlGateRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly toolDefs: ToolDefinitionRepositoryPort,
    @Inject(TOOL_INVOKER) private readonly toolInvoker: ToolInvokerPort,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
  ) {
    super();
  }

  /** @param job - `{ tenantId, decisionId }` payload from `HitlDeferredFollowupQueueProducer.enqueue` */
  async process(job: Job<{ tenantId: string; decisionId: string }>): Promise<void> {
    const { tenantId, decisionId } = job.data;
    const decision = await this.decisions.findById(tenantId, decisionId);
    if (!decision) {
      this.logger.warn(`HITL_DEFERRED_FOLLOWUP_DECISION_NOT_FOUND decisionId=${decisionId}`);
      return;
    }
    if (decision.decision !== 'approved' && decision.decision !== 'edited_approved') {
      // Not this job's concern (e.g. denied) — nothing to execute.
      return;
    }

    const gate = await this.gates.findById(tenantId, decision.gateId);
    if (!gate || gate.attachmentKind !== 'tool') {
      this.logger.warn(`HITL_DEFERRED_FOLLOWUP_GATE_NOT_TOOL decisionId=${decisionId}`);
      return;
    }
    const tool = await this.toolDefs.findByApiRef(tenantId, gate.attachmentRef);
    if (!tool) {
      this.logger.warn(`HITL_DEFERRED_FOLLOWUP_TOOL_UNKNOWN decisionId=${decisionId} api_ref=${gate.attachmentRef}`);
      return;
    }

    const args = decision.editedArguments ?? decision.proposedAction.arguments ?? {};
    const result = await this.toolInvoker.invoke(tool, args);
    this.logger.log({ decisionId, ok: result.ok }, 'hitl-deferred-followup tool call complete');

    // R-H9 — the caller is notified through their configured channel; v1
    // has no per-caller channel of its own (no caller identity/contact
    // beyond the session), so the outcome is recorded via `outcomeNotifiedAt`
    // and surfaced through the reviewer console / conversation SPA's own
    // deferred-outcome polling rather than a separate push here.
    await this.notifications.send({
      channel: 'in_app',
      subject: 'Deferred approval executed',
      body: result.ok ? `Approved action for gate ${gate.id} completed.` : `Approved action for gate ${gate.id} failed to execute.`,
    });
    await this.decisions.markOutcomeNotified(decisionId);
  }
}
