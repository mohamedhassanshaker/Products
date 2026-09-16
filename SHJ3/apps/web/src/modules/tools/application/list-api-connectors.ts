/**
 * The HTTP-connector catalogue with live per-connector bind counts — backs both
 * B3 step 4 sub-tab C's toggle list and B5 tab 3's catalogue-with-counts table.
 * Mirrors `list-skills.ts`'s identical join reasoning: `ApiConnectorRepository`
 * and `ToolBindingRepository` are different tables, joined here on every call
 * rather than cached, so the count is always "reflected immediately"
 * (`ToolBindingRepository.countEnabledBindingsByApiConnector`'s own doc comment).
 */

import type { ApiConnectorRepository, ApiConnectorRow } from "../ports/api-connector-repository.js";
import type { ToolBindingRepository } from "../ports/tool-binding-repository.js";

export type ApiConnectorCatalogRow = ApiConnectorRow & {
  readonly boundAgentVersionCount: number;
};

export interface ListApiConnectorsResult {
  readonly rows: readonly ApiConnectorCatalogRow[];
}

export interface ListApiConnectorsDeps {
  readonly connectors: ApiConnectorRepository;
  readonly bindings: ToolBindingRepository;
}

export class ListApiConnectors {
  constructor(private readonly deps: ListApiConnectorsDeps) {}

  async execute(): Promise<ListApiConnectorsResult> {
    const { connectors, bindings } = this.deps;

    const [connectorRows, counts] = await Promise.all([
      connectors.list(),
      bindings.countEnabledBindingsByApiConnector(),
    ]);

    const rows = connectorRows.map((connector): ApiConnectorCatalogRow => ({
      ...connector,
      boundAgentVersionCount: counts.get(connector.id) ?? 0,
    }));

    return { rows };
  }
}
