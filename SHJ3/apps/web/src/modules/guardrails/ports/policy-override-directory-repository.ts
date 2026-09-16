/**
 * Screen 3 (Guardrails & policies), "Per-agent overrides" — the READ-ONLY, tenant-wide
 * directory of every active `PolicyOverride` row, across every agent, joined to the real
 * agent name. This is deliberately the inverse query direction from `modules/agents`'
 * existing `PolicyOverrideRepository.listOverridesForAgent` (one agent → its overrides);
 * this port answers "every agent, across all policies" instead, which is this screen's own
 * job per the task brief — it does not replace or duplicate the per-agent wizard's real,
 * writable port.
 */

export interface PolicyOverrideDirectoryRow {
  readonly id: string;
  readonly policyKey: string;
  readonly agentId: string;
  readonly agentName: string;
  /** `Value` | `Disabled` (`CK_PolicyOverrides_mode`). */
  readonly mode: string;
  readonly valueJson: string | null;
  /** Mandatory and substantive — `CK_PolicyOverrides_reasonSubstantive` (`LEN(LTRIM(RTRIM(reason))) >= 10`). */
  readonly reason: string;
  readonly createdAt: Date;
}

export interface PolicyOverrideDirectoryRepository {
  /** Active overrides only (`removedAt IS NULL`) — a removed override is history, not a
   *  live "this agent currently deviates from the platform" fact this screen reports. */
  listActive(): Promise<readonly PolicyOverrideDirectoryRow[]>;
}
