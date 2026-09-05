// Target Architecture Blueprint Phase 2 (BL-33, ADR-0011, LLD §14.9.6) — the Model
// Gateway's actual call path (`resolveModelChainForRoute`/`callModelGatewayText`/
// `callModelGatewayStructured`/`enforceModelBudget`) and Route v2 CRUD have moved to
// `@nextbot/model-gateway` (completing the "extract Module F" move Phase 1 started
// for the provider registry/catalog). This file now re-exports them unchanged so
// every pre-existing caller (`agent-run-service.ts`'s `enforceModelBudget`,
// `http/admin-routes.ts`, `scripts/seed.ts`) keeps its existing import path and
// signature — `agent-platform -> model-gateway` is an already-allowed module edge
// (`eslint.config.mjs`'s `MODULE_ALLOW_LIST`).
import { getProviderByType, registerModelProvider, listProviderRegistrations } from "@nextbot/model-gateway";

export {
  resolveModelChainForRoute,
  callModelGatewayText,
  callModelGatewayStructured,
  enforceModelBudget,
  insertModelBudget,
  type ModelBudgetRow,
} from "@nextbot/model-gateway";

export { getProviderByType };
// Phase 1's re-export names, unchanged for `scripts/seed.ts`/legacy console callers.
export { registerModelProvider as registerModelProviderInGateway, listProviderRegistrations as listModelProvidersInGateway };
export { registerModelProvider, listProviderRegistrations as listModelProviders };
