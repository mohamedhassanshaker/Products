import type { TenantContext } from "@nextbot/db";
import type { AuthzSimulateRequest, AuthzSimulateResponse } from "@nextbot/contracts";
import { simulate } from "../application/simulate-service.js";

/** `http/` layer (LLD §2.2) — plain functions; RBAC checks (`security_settings`,
 * per LLD §14.2.7) are applied by the composition root (`apps/web`), matching
 * every other module's convention. */
export async function handleSimulate(ctx: TenantContext, request: AuthzSimulateRequest): Promise<AuthzSimulateResponse> {
  return simulate(ctx, request);
}
