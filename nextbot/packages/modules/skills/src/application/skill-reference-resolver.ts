import type { TenantContext } from "@nextbot/db";
import type { SkillArtifact } from "@nextbot/contracts";
import { SkillReferenceNotFoundError } from "@nextbot/contracts";
import { resolveCapabilityGroupIdsByNames } from "@nextbot/tool-registry";
import { findToolByName } from "@nextbot/tool-registry";
import { findConnectorByName } from "@nextbot/connectors";

/**
 * ADR-0015 §2.2 / FR-AGT-11 — "A skill referencing a capability group, tool, or
 * knowledge collection that does not exist or is not enabled for the tenant fails
 * validation at save, naming the specific missing reference." Resolves every name
 * in `scope.capabilityGroups`/`scope.tools` to a real, tenant-owned id, throwing
 * `SkillReferenceNotFoundError` (fields naming the exact offending array index) on
 * the first one that doesn't resolve — never a partial/dangling save.
 *
 * `scope.knowledge` is deliberately NOT resolved here (this phase's brief: "there's
 * nothing to validate against yet — just store the reference" — Knowledge/Graph
 * RAG doesn't exist until Phase 7+).
 */
export interface ResolvedSkillScope {
  capabilityGroupIds: string[];
  toolIds: string[];
}

/** Parses a `"payment.refund@billing_core"` tool pin into its tool-name/connector-name
 * halves. Throws with the same field-scoped error shape as every other resolution
 * failure below when the pin isn't in the expected `name@connector` form at all. */
function parseToolPin(pin: string, path: string): { toolName: string; connectorName: string } {
  const at = pin.lastIndexOf("@");
  if (at <= 0 || at === pin.length - 1) {
    throw new SkillReferenceNotFoundError(path, `Tool reference '${pin}' is not in the required 'toolName@connectorName' form.`);
  }
  return { toolName: pin.slice(0, at), connectorName: pin.slice(at + 1) };
}

export async function resolveSkillScopeReferences(ctx: TenantContext, scope: SkillArtifact["scope"]): Promise<ResolvedSkillScope> {
  const capabilityGroupIds: string[] = [];
  for (let i = 0; i < scope.capabilityGroups.length; i++) {
    const name = scope.capabilityGroups[i]!;
    const [id] = await resolveCapabilityGroupIdsByNames(ctx, [name]);
    if (!id) {
      throw new SkillReferenceNotFoundError(`scope.capabilityGroups[${i}]`, `Capability group '${name}' does not exist or is not enabled for this tenant.`);
    }
    capabilityGroupIds.push(id);
  }

  const toolIds: string[] = [];
  for (let i = 0; i < scope.tools.length; i++) {
    const pin = scope.tools[i]!;
    const path = `scope.tools[${i}]`;
    const { toolName, connectorName } = parseToolPin(pin, path);
    const connector = await findConnectorByName(ctx, ctx.environment, connectorName);
    if (!connector) {
      throw new SkillReferenceNotFoundError(path, `Connector '${connectorName}' does not exist or is not enabled for this tenant.`);
    }
    const tool = await findToolByName(ctx, connector.id, toolName);
    if (!tool) {
      throw new SkillReferenceNotFoundError(path, `Tool '${pin}' does not exist or is not enabled for this tenant.`);
    }
    toolIds.push(tool.id);
  }

  return { capabilityGroupIds, toolIds };
}
