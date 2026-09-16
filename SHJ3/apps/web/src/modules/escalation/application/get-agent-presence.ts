import type {
  AgentPresenceRepository,
  AgentPresenceRow,
} from "../ports/agent-presence-repository.js";

/** api.md §6.8 `GET /handover/presence` — "the signed-in agent's presence." `getOrCreate`
 *  materialises a default `Offline` row for an agent who has never toggled status yet,
 *  so the workspace always has something real to render rather than special-casing a
 *  missing row. */
export class GetAgentPresence {
  constructor(private readonly deps: { readonly presence: AgentPresenceRepository }) {}

  async execute(staffUserId: string, now: Date): Promise<AgentPresenceRow> {
    return this.deps.presence.getOrCreate(staffUserId, now);
  }
}
