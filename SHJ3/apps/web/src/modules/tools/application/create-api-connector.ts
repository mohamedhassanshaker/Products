/**
 * Register an API connector — B3 step 4 sub-tab C / B5 tab 3's **+ Add API
 * connector**.
 *
 * Fulfils the brief's rule that "every API connector automatically becomes a
 * callable skill": the *mechanism* is `TR_ApiConnectors_projectSkill` (a DB
 * trigger, fired inside `ApiConnectorRepository.create`'s own insert statement)
 * plus that repository method re-reading and returning `projectedSkillId` — not
 * anything this use case itself does. This class stays a one-line passthrough
 * on purpose, so there is exactly one place ("the port's `create`") that has to
 * know the projected skill exists at all.
 */

import type {
  ApiConnectorRepository,
  ApiConnectorRow,
  NewApiConnectorInput,
} from "../ports/api-connector-repository.js";

export type CreateApiConnectorInput = NewApiConnectorInput;

export interface CreateApiConnectorResult {
  readonly connector: ApiConnectorRow;
}

export interface CreateApiConnectorDeps {
  readonly connectors: ApiConnectorRepository;
}

export class CreateApiConnector {
  constructor(private readonly deps: CreateApiConnectorDeps) {}

  async execute(input: CreateApiConnectorInput): Promise<CreateApiConnectorResult> {
    const connector = await this.deps.connectors.create(input);
    return { connector };
  }
}
