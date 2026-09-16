/**
 * Edit an API connector — B3 step 4 sub-tab C / B5 tab 3's Edit dialog, every
 * field independently optional in the same call, mirroring `iam`'s
 * `edit-user.ts` shape.
 *
 * `ApiConnectorRepository.update`'s own doc comment carries two rules this use
 * case must not reimplement: changing `method`/`urlTemplate`/`authMode` resets
 * `testState` to `Untested` ("the badge must never claim a test that covered a
 * different request", `docs/api.md` §6.5), and the adapter re-syncs the
 * trigger-projected `Skill`'s `name`/schemas/`rateLimitPolicyId` itself (closing
 * `TR_ApiConnectors_projectSkill`'s own real, confirmed gap — it only re-syncs
 * `deletedAt` on UPDATE). This use case only forwards whichever fields the
 * caller actually supplied.
 */

import type { ApiConnectorRepository } from "../ports/api-connector-repository.js";
import type { ApiConnectorAuthMode, ApiConnectorMethod } from "../domain/tool-catalog.js";

export interface UpdateApiConnectorInput {
  readonly id: string;
  readonly name?: string;
  readonly method?: ApiConnectorMethod;
  readonly urlTemplate?: string;
  readonly authMode?: ApiConnectorAuthMode;
  readonly credentialSecretRef?: string | null;
  readonly headersJson?: string | null;
  readonly requestSchemaJson?: string | null;
  readonly responseSchemaJson?: string | null;
  readonly timeoutMs?: number;
  readonly now: Date;
}

export interface UpdateApiConnectorDeps {
  readonly connectors: ApiConnectorRepository;
}

export class UpdateApiConnector {
  constructor(private readonly deps: UpdateApiConnectorDeps) {}

  async execute(input: UpdateApiConnectorInput): Promise<void> {
    await this.deps.connectors.update(
      input.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.method !== undefined ? { method: input.method } : {}),
        ...(input.urlTemplate !== undefined ? { urlTemplate: input.urlTemplate } : {}),
        ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
        ...(input.credentialSecretRef !== undefined
          ? { credentialSecretRef: input.credentialSecretRef }
          : {}),
        ...(input.headersJson !== undefined ? { headersJson: input.headersJson } : {}),
        ...(input.requestSchemaJson !== undefined
          ? { requestSchemaJson: input.requestSchemaJson }
          : {}),
        ...(input.responseSchemaJson !== undefined
          ? { responseSchemaJson: input.responseSchemaJson }
          : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      },
      input.now,
    );
  }
}
