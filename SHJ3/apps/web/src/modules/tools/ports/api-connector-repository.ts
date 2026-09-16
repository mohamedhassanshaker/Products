/** B3 step 4 sub-tab C / B5 tab 3 — HTTP connectors the platform may call. */

import type {
  ApiConnectorAuthMode,
  ApiConnectorMethod,
  ApiConnectorTestState,
} from "../domain/tool-catalog.js";

export interface ApiConnectorRow {
  readonly id: string;
  readonly name: string;
  readonly method: ApiConnectorMethod;
  readonly urlTemplate: string;
  readonly authMode: ApiConnectorAuthMode;
  readonly credentialSecretRef: string | null;
  readonly headersJson: string | null;
  readonly requestSchemaJson: string | null;
  readonly responseSchemaJson: string | null;
  readonly timeoutMs: number;
  readonly testState: ApiConnectorTestState;
  readonly lastTestedAt: Date | null;
  readonly sampleResponseJson: string | null;
  readonly rateLimitPolicyId: string;
  /** The `Skill` row `TR_ApiConnectors_projectSkill` creates automatically — surfaced so a caller never has to separately query for it. */
  readonly projectedSkillId: string;
}

export interface NewApiConnectorInput {
  readonly name: string;
  readonly method: ApiConnectorMethod;
  readonly urlTemplate: string;
  readonly authMode: ApiConnectorAuthMode;
  readonly credentialSecretRef: string | null;
  readonly headersJson: string | null;
  readonly requestSchemaJson: string | null;
  readonly responseSchemaJson: string | null;
  readonly timeoutMs: number;
  /** `ApiConnectors.rateLimitPolicyId` is `NOT NULL` — every connector needs one, and the wireframe exposes no separate rate-limit-policy management screen, so a connector creates its own named policy alongside itself in the same transaction. */
  readonly rateLimitPolicy: {
    readonly name: string;
    readonly requestsPerWindow: number;
    readonly windowSeconds: number;
    readonly burst: number;
    readonly scope: "PerTenant" | "PerConversation" | "PerCitizen" | "PerAgent";
  };
  readonly now: Date;
}

export type DeleteApiConnectorResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "tools.connector_in_use";
      readonly boundAgentVersionIds: readonly string[];
    };

export interface ApiConnectorRepository {
  list(): Promise<readonly ApiConnectorRow[]>;
  get(id: string): Promise<ApiConnectorRow | null>;

  /** Inserts the connector row; `TR_ApiConnectors_projectSkill` creates the paired `Skill` in the same statement, at the database. Re-reads and returns both ids. */
  create(input: NewApiConnectorInput): Promise<ApiConnectorRow>;

  /**
   * Updates the connector **and** re-syncs the paired `Skill`'s `name`/`inputSchemaJson`
   * (from `requestSchemaJson`)/`outputSchemaJson`/`rateLimitPolicyId` — `TR_ApiConnectors_
   * projectSkill` only re-syncs `deletedAt` on UPDATE, never the other columns (a real,
   * confirmed gap in the trigger, see `tasks/todo.md`'s B-3 review), so this method closes
   * it at the application layer rather than leaving the projected `Skill` to silently
   * drift from the connector's current schema. Changing `method`/`urlTemplate`/`authMode`
   * resets `testState` to `'Untested'` (`docs/api.md` §6.5: "the badge must never claim a
   * test that covered a different request").
   */
  update(
    id: string,
    input: {
      readonly name?: string;
      readonly method?: ApiConnectorMethod;
      readonly urlTemplate?: string;
      readonly authMode?: ApiConnectorAuthMode;
      readonly credentialSecretRef?: string | null;
      readonly headersJson?: string | null;
      readonly requestSchemaJson?: string | null;
      readonly responseSchemaJson?: string | null;
      readonly timeoutMs?: number;
    },
    now: Date,
  ): Promise<void>;

  /** Soft-deletes the connector; the trigger cascades `deletedAt` onto the paired `Skill`. Refused while any enabled `ToolBinding` references either. */
  softDelete(id: string, now: Date): Promise<DeleteApiConnectorResult>;

  /** `docs/api.md` §5.6: "A failed test is a successful test *run*" — always resolves `{ok:true}` at this layer; `ok`/`reason` describe the probe's own outcome, not this call's success. */
  recordTestResult(
    id: string,
    result: { readonly ok: boolean; readonly sampleResponseJson: string | null },
    now: Date,
  ): Promise<void>;
}
