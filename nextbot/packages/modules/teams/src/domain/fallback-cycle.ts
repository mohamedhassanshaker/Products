import { TeamFallbackCycleError, type TeamMemberSpec } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-10, LLD §14.7.2) — a real
 * cycle-detection walk over the members' `fallbackMemberKey` graph.
 *
 * The database can (and does) enforce `fallback_member_id <> id`, but a two-or-more
 * node cycle (A falls back to B, B falls back to A) is not expressible as a CHECK.
 * Left unrejected it is a genuine runtime hazard, not a cosmetic one: the delegation
 * executor's step 6 recurses into `fallback_member_id` when a member is unavailable,
 * so a cycle among members that are ALL unavailable would recurse forever.
 * FR-ORC-10's contract is "the supervisor never silently answers without the
 * intended specialist" — which requires every fallback chain to terminate in a real
 * `Escalate`, never in a loop.
 *
 * Pure (`domain/`, no I/O) — it operates on the authored specs, so a cycle is
 * rejected at save time, before a single row is written.
 */

/**
 * Validates that no member's fallback chain cycles, and that every
 * `fallbackMemberKey` names a member that actually exists in this artifact.
 *
 * @param members the artifact's authored members, in order.
 * @throws {TeamFallbackCycleError} naming the exact cycle path (e.g.
 *   `["billing", "refunds", "billing"]`) so the author can see which edge to cut.
 */
export function assertNoFallbackCycle(members: TeamMemberSpec[]): void {
  const byKey = new Map(members.map((m) => [m.key, m]));

  /** Standard three-colour DFS: `visiting` is the current recursion stack (a hit
   * there is a back-edge, i.e. a cycle); `done` memoises fully-explored nodes so an
   * N-member artifact costs O(N), not O(N^2). */
  const visiting = new Set<string>();
  const done = new Set<string>();

  const walk = (key: string, path: string[]): void => {
    if (done.has(key)) return;
    if (visiting.has(key)) {
      // Trim the prefix that leads INTO the cycle so the reported path is the
      // cycle itself, not the walk that found it.
      const start = path.indexOf(key);
      throw new TeamFallbackCycleError([...path.slice(start === -1 ? 0 : start), key]);
    }
    const member = byKey.get(key);
    // A dangling `fallbackMemberKey` is a different (also fatal) error, reported by
    // the caller's own reference check — this walk simply stops rather than
    // pretending the chain terminates safely.
    if (!member) return;

    visiting.add(key);
    if (member.fallbackAction === "Member" && member.fallbackMemberKey) {
      walk(member.fallbackMemberKey, [...path, key]);
    }
    visiting.delete(key);
    done.add(key);
  };

  for (const member of members) walk(member.key, []);
}
