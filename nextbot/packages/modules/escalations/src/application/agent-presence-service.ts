import type { TenantContext } from "@nextbot/db";
import {
  ensureAgentPresence,
  listAgentPresenceForTenant as listAgentPresenceForTenantRepo,
  setAgentMaxConcurrent as setAgentMaxConcurrentRepo,
  setAgentPresenceState as setAgentPresenceStateRepo,
  type AgentPresenceRow,
  type AgentPresenceStateValue,
} from "../infrastructure/agent-presence-repository.js";

/**
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) — agent
 * presence application service.
 *
 * **Deliberate scope narrowing**: `state` (`Available`/`Busy`/`Away`/`Offline`) does
 * NOT gate claiming — only `current_load`/`max_concurrent` do (enforced atomically in
 * `escalation-repository.ts#claimEscalationWithCeilingCheck`). FR-ESC-05's own
 * boundary note is specifically about the *concurrency ceiling* ("new escalations
 * still route per FR-ESC-03's rules and wait visibly rather than routing to an agent
 * already at their concurrency ceiling") — it does not ask for presence `state` to
 * block a claim, and this codebase has no mechanic today that auto-routes a *specific*
 * agent (only a *queue*, per FR-ESC-03) for `state` to gate in the first place. `state`
 * is therefore purely a self-service/informational signal this phase — a real input
 * for a future auto-assignment mechanic (`AutoAssigned` in `escalation_assignment_log`
 * is reserved for exactly that), not built here.
 */

/** Read-or-provision a user's presence row (auto-defaults to `Offline`/3/0 on first
 * reference, per FR-ESC-05's own "no separate provisioning step" requirement). */
export async function getOrCreateAgentPresence(ctx: TenantContext, userId: string): Promise<AgentPresenceRow> {
  return ensureAgentPresence(ctx, userId);
}

/** Every agent's presence row for the tenant — the admin-facing overview. */
export async function listAgentPresenceForTenant(ctx: TenantContext): Promise<AgentPresenceRow[]> {
  return listAgentPresenceForTenantRepo(ctx);
}

/** Self-service: an agent sets their OWN `state`. Callers must derive `userId` from
 * the acting session, never from client-supplied input, so an agent can only ever
 * toggle their own presence via this function. */
export async function setMyPresenceState(ctx: TenantContext, userId: string, state: AgentPresenceStateValue): Promise<AgentPresenceRow> {
  return setAgentPresenceStateRepo(ctx, userId, state);
}

/** Admin-configured: sets another (or the same) agent's `max_concurrent` ceiling.
 * Callers (the composition-root route) must independently verify `userId` belongs to
 * the acting tenant before calling this — see `apps/web`'s `agent-presence/[userId]`
 * route for the `findUserById` ownership check this function itself does not repeat
 * (this module has no allowed read access to a "list of valid user ids" beyond the
 * `iam` edge it already has via `@nextbot/iam`'s `findUserById`, used at the
 * composition-root call site identically to how `reassignEscalation` already
 * validates a client-supplied agent id). */
export async function setAgentMaxConcurrent(ctx: TenantContext, userId: string, maxConcurrent: number): Promise<AgentPresenceRow> {
  return setAgentMaxConcurrentRepo(ctx, userId, maxConcurrent);
}

export type { AgentPresenceRow, AgentPresenceStateValue };
