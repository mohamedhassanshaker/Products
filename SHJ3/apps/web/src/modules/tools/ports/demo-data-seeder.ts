/**
 * Deterministic demo-data seeding for `tools` — this module's slice of the same
 * long-standing B-0 open item `iam/ports/demo-data-seeder.ts` closed for
 * users/teams/roles. Mirrors that port's shape and reasoning; read its own
 * module comment first.
 *
 * ## Why this port exists at all, given three of its four methods could almost be ordinary CRUD
 *
 * Unlike `iam` (where every seeded entity needs a state the ordinary port
 * structurally refuses to produce — `isSystem: true`, a status other than
 * `'Invited'`, ...), `SkillRepository.createNative` /
 * `McpServerRepository.create` + `recordSuccessfulDiscovery` /
 * `ApiConnectorRepository.create` + `recordTestResult` can *already* produce
 * every seeded state this wave's brief asks for (an attached-by-default flag, a
 * `Connected` server with pre-discovered tools, a `Tested` connector with a
 * sample response) — there is no hard state-shape gate to bypass for those
 * three. What they lack is **idempotency**: none of those ordinary
 * `create`/`createNative` methods check for an existing row first, so re-running
 * a seed script against them a second time would create duplicates, unlike
 * `iam`'s `ensureTeam`/`ensureStaffUser`. This port's first three methods add
 * exactly that idempotent "find by name, else create (then bring to the seeded
 * state)" wrapper.
 *
 * `CircuitBreakerConfig` is the one genuine gap, in the same sense `iam`'s gaps
 * are genuine: `CircuitBreakerRepository` (the ordinary port) exposes `list` /
 * `get` / `update` / `appendEvent` / `listRecentEvents` but no `create` at all,
 * because B5 tab 4 never creates a new breaker through its own UI — only edits,
 * resets or trips one that already exists. `ensureCircuitBreaker` is this port's
 * fourth method for exactly that reason.
 */

import type {
  ApiConnectorAuthMode,
  ApiConnectorMethod,
  McpAuthMode,
  McpTransport,
} from "../domain/tool-catalog.js";
import type { CircuitBreakerTargetKind, FallbackStrategy } from "../domain/circuit-breaker.js";

export interface NewSkillSeed {
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly inputSchemaJson: string;
  readonly isAttachedByDefault: boolean;
}

export interface NewMcpServerSeed {
  readonly name: string;
  readonly endpoint: string;
  readonly transport: McpTransport;
  readonly authMode: McpAuthMode;
  readonly credentialSecretRef: string | null;
  /**
   * When non-empty, the server is seeded already `Connected`, with exactly
   * these discovered descriptors (via `McpServerRepository.
   * recordSuccessfulDiscovery` — never the live discovery call). Empty means
   * seeded `NotConnected` (the ordinary port's own `create()` default),
   * matching the wireframe's Customs server.
   */
  readonly discoveredTools: readonly {
    readonly name: string;
    readonly description: string | null;
    readonly inputSchemaJson: string;
  }[];
}

export interface NewApiConnectorSeed {
  readonly name: string;
  readonly method: ApiConnectorMethod;
  readonly urlTemplate: string;
  readonly authMode: ApiConnectorAuthMode;
  readonly credentialSecretRef: string | null;
  readonly timeoutMs: number;
  readonly rateLimitPolicy: {
    readonly name: string;
    readonly requestsPerWindow: number;
    readonly windowSeconds: number;
    readonly burst: number;
    readonly scope: "PerTenant" | "PerConversation" | "PerCitizen" | "PerAgent";
  };
  /** When set, the connector is seeded already `Tested` with this sample response and `lastTestedAt` = the seed run's `now` (via `recordTestResult`). Omit for the wireframe's `Untested` connector. */
  readonly seededSampleResponseJson?: string;
}

export interface NewCircuitBreakerSeed {
  readonly targetKind: CircuitBreakerTargetKind;
  /** Exactly one of `targetId`/`targetKey` may be non-null — `CK_CircuitBreakerConfigs_targetPaired`. */
  readonly targetId: string | null;
  readonly targetKey: string | null;
  readonly failureThreshold: number;
  readonly windowSeconds: number;
  readonly cooldownSeconds: number;
  readonly halfOpenProbes: number;
  readonly fallbackStrategy: FallbackStrategy;
  readonly cachedAnswerMaxAgeSeconds: number | null;
  readonly serveCachedWhenDown: boolean;
  readonly degradedModeMessage: string;
  readonly isEnabled: boolean;
}

export interface DemoDataSeeder {
  /** Create-or-find by `name`. Returns the skill's id. */
  ensureNativeSkill(input: NewSkillSeed, now: Date): Promise<string>;

  /** Create-or-find by `name`. Returns the server's id. */
  ensureMcpServer(input: NewMcpServerSeed, now: Date): Promise<string>;

  /**
   * Create-or-find by `name`. Returns the connector's id (not the projected
   * skill's — `TR_ApiConnectors_projectSkill` creates that automatically,
   * exactly as `ApiConnectorRepository.create`'s own doc comment describes; a
   * caller never creates a duplicate `Skill` row for a seeded connector).
   */
  ensureApiConnector(input: NewApiConnectorSeed, now: Date): Promise<string>;

  /**
   * Create-or-find by `(targetKind, targetId, targetKey)` — the same triple
   * `UQ_CircuitBreakerConfigs_target` enforces. Returns the config's id; call
   * `CircuitBreakerRepository.get()` (the ordinary port, already needed by any
   * caller that also seeds Redis state or a ledger event) for the rest of the row.
   */
  ensureCircuitBreaker(input: NewCircuitBreakerSeed, now: Date): Promise<string>;
}
