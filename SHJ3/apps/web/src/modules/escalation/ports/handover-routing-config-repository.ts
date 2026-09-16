/**
 * The singleton `HandoverConfig` row, narrowed to exactly the fields *this* module
 * needs — the mirror image of `channels/ports/handover-config-repository.ts`'s own
 * narrowing (that port's doc comment names these three fields as "B7/B8's escalation-
 * queue concern... read here so a save never clobbers them but never written by this
 * module"). Each module owns writing its own slice of the same row; neither ever writes
 * the other's fields.
 */
export interface HandoverRoutingConfigRow {
  readonly defaultQueueTeamId: string;
  readonly maxWaitSecondsBeforeRequeue: number;
  readonly supervisorAlertTeamId: string | null;
}

export interface HandoverRoutingConfigRepository {
  getSingleton(): Promise<HandoverRoutingConfigRow | null>;
}
