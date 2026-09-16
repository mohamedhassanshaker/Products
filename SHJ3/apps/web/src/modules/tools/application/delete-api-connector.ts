/**
 * Delete (soft) an API connector — B3 step 4 sub-tab C / B5 tab 3's Delete
 * action.
 *
 * Pure passthrough to `ApiConnectorRepository.softDelete`, whose own doc comment
 * documents both rules this use case never has to reimplement: the delete is
 * refused with `tools.connector_in_use` while any enabled `ToolBinding`
 * references the connector *or* its trigger-projected skill, and a successful
 * delete cascades `deletedAt` onto that projected `Skill` at the database.
 */

import type {
  ApiConnectorRepository,
  DeleteApiConnectorResult,
} from "../ports/api-connector-repository.js";

export interface DeleteApiConnectorInput {
  readonly id: string;
  readonly now: Date;
}

export interface DeleteApiConnectorDeps {
  readonly connectors: ApiConnectorRepository;
}

export class DeleteApiConnector {
  constructor(private readonly deps: DeleteApiConnectorDeps) {}

  async execute(input: DeleteApiConnectorInput): Promise<DeleteApiConnectorResult> {
    return this.deps.connectors.softDelete(input.id, input.now);
  }
}
