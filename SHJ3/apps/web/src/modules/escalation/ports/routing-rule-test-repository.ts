/** `RoutingRuleTests` — a recorded run of the tester, "so a pre-live check is evidence
 *  rather than a transient reassurance" (schema doc comment). Write-only from this
 *  module's own perspective; nothing reads it back yet (a future B-9 analytics pass
 *  would), which is why this port offers only `record`. */

export interface RecordRoutingRuleTestInput {
  readonly sampleJson: string;
  readonly firedRoutingRuleId: string | null;
  readonly firedRuleOrdinal: number | null;
  readonly resolvedTarget: string;
  readonly fellToDefaultQueue: boolean;
  readonly ruleSetHash: string;
  readonly ranByStaffUserId: string;
  readonly now: Date;
}

export interface RoutingRuleTestRepository {
  record(input: RecordRoutingRuleTestInput): Promise<{ readonly id: string }>;
}
