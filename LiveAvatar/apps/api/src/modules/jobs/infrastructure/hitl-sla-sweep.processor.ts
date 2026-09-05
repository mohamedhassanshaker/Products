import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import {
  HITL_DECISION_REPOSITORY,
  HITL_DEFERRED_FOLLOWUP_QUEUE_PORT,
  REVIEWER_GROUP_REPOSITORY,
  type HitlDecisionRepositoryPort,
  type HitlDeferredFollowupQueuePort,
  type ReviewerGroupRepositoryPort,
} from '../../hitl';
import { NOTIFICATION_PORT, type NotificationPort } from '../../../common/notifications/notification.port';
import { HITL_SLA_SWEEP_QUEUE } from '../domain/queue-names';

/**
 * BullMQ worker for the `hitl-sla-sweep` repeatable job (Phase 14, BL-053;
 * `ARCHITECTURE_NOTES.md` §6.2 point 3) — server-side defense-in-depth
 * alongside the Python interpreter's own locally-tracked SLA deadline.
 * Maps R-H2's four `timeoutBehavior` values onto the decision's terminal
 * state; `reviewerId` is left `null` on every path here since no human
 * decided.
 *
 * **`escalate` scope note (v1)**: notifies the escalation `ReviewerGroup`
 * and marks the decision `escalated`, but does not build a dedicated
 * "wider group can still act on this" review surface beyond that — the
 * decision no longer appears in the normal `pending` queue once escalated.
 * A live blocking/pre-speech turn has already taken its own `on_deadline`
 * path in the interpreter by this point regardless (the same short-poll
 * loop that hit its local deadline), so this is a metrics/notification
 * concern more than a live-call one. Revisit if product feedback wants a
 * real escalation-queue UI.
 */
@Processor(HITL_SLA_SWEEP_QUEUE)
export class HitlSlaSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(HitlSlaSweepProcessor.name);

  constructor(
    @Inject(HITL_DECISION_REPOSITORY) private readonly decisions: HitlDecisionRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
    @Inject(HITL_DEFERRED_FOLLOWUP_QUEUE_PORT) private readonly deferredFollowup: HitlDeferredFollowupQueuePort,
  ) {
    super();
  }

  async process(job: Job): Promise<{ finalized: number }> {
    const overdue = await this.decisions.listOverdue(new Date());
    let finalized = 0;
    for (const item of overdue) {
      const terminal =
        item.timeoutBehavior === 'auto_approve'
          ? 'approved'
          : item.timeoutBehavior === 'auto_deny'
            ? 'denied'
            : item.timeoutBehavior === 'escalate'
              ? 'escalated'
              : 'deferred';
      const updated = await this.decisions.finalizeTimedOut(item.decision.id, terminal);
      if (!updated) {
        continue;
      }
      finalized++;

      if (item.timeoutBehavior === 'escalate' && item.escalateToGroupId) {
        const group = await this.reviewerGroups.findById(updated.tenantId, item.escalateToGroupId);
        for (const channel of group?.notificationChannels ?? []) {
          await this.notifications.send({
            channel: channel.type,
            address: channel.address,
            subject: 'HITL decision escalated',
            body: `A HITL decision (gate ${updated.gateId}) timed out and was escalated to your group.`,
          });
        }
      }

      // A `deferred`-type gate whose timeout auto-resolves to an
      // executable outcome still needs the same out-of-band tool execution
      // a human approval would trigger (`DecideHitlDecisionUseCase`'s own
      // mirror of this block) — a caller who already left is exactly why
      // this gate was deferred in the first place.
      if (item.gateType === 'deferred' && terminal === 'approved' && updated.proposedAction.kind === 'tool_call') {
        await this.deferredFollowup.enqueue({ tenantId: updated.tenantId, decisionId: updated.id });
      }
    }
    this.logger.log({ jobId: job.id, finalized }, 'hitl-sla-sweep run complete');
    return { finalized };
  }
}
