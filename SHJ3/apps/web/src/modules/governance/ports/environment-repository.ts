/** `platform.Environments` (B14 tab 1) joined, in application code, with a real count of
 *  `VersionDeployments` rows per environment — two separate Prisma clients (ADR-0011, no
 *  cross-client `@relation`), so this is two queries joined here, never SQL. */

export interface EnvironmentRow {
  readonly key: string;
  readonly displayName: string;
  readonly ordinal: number;
  readonly promotesToKey: string | null;
  readonly isLive: boolean;
  /** Distinct `Agent`s with at least one `Deployed` version in this environment. */
  readonly agentCount: number;
  /** Every currently-`Deployed` version's real label (`v1.3`, `v2.1`, ...), agent-qualified
   *  for display (B14 tab 1's "Versions" column: `v1.3 / v2.1 / v2.4`). */
  readonly deployedVersionLabels: readonly string[];
}

export interface EnvironmentRepository {
  list(): Promise<readonly EnvironmentRow[]>;
  findByKey(key: string): Promise<EnvironmentRow | null>;
}
