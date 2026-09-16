/** `PublishGates` — singleton (`singletonKey=1`), B13 tab 3's five settings. */

export interface PublishGateRow {
  readonly id: string;
  readonly blockOnSuiteFailure: boolean;
  readonly minAccuracy: number;
  readonly minGroundedness: number;
  readonly redTeamMustScore100: boolean;
  readonly blockOnBoundLocaleBelow100: boolean;
  readonly updatedByStaffUserId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UpdatePublishGateInput {
  readonly blockOnSuiteFailure: boolean;
  readonly minAccuracy: number;
  readonly minGroundedness: number;
  readonly redTeamMustScore100: boolean;
  readonly blockOnBoundLocaleBelow100: boolean;
  readonly updatedByStaffUserId: string;
  readonly now: Date;
}

export interface PublishGateRepository {
  /**
   * The one, singleton row. Real deployments seed it with the schema's own defaults
   * (`blockOnSuiteFailure`/`minAccuracy=0.85`/`minGroundedness=0.80`); a tenant schema
   * provisioned before this row was ever seeded gets one created here, on first read,
   * with those identical defaults — never a silent `null`, since every gate-evaluation
   * caller needs real thresholds to compare against.
   */
  getOrCreateDefault(seedStaffUserId: string, now: Date): Promise<PublishGateRow>;
  update(input: UpdatePublishGateInput): Promise<PublishGateRow>;
}
