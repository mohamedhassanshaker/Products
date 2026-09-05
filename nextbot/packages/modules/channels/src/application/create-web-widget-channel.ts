import { ChannelNameDuplicateError, type CreateWebWidgetChannelRequest } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { generateChannelPublicKey } from "../domain/public-key.js";
import { findChannelByName, findChannelById, insertChannel, type ChannelRow } from "../infrastructure/channel-repository.js";

/**
 * Creates a `WebWidget` channel (BL-04). Scoped to `WebWidget` only — the other 8
 * channel types' setup wizards (FR-OC-03) are a later backlog phase; this exists so a
 * tenant has a real, embeddable widget channel + public key without needing the full
 * FR-OC-02 channel-management surface built first.
 *
 * @throws {ChannelNameDuplicateError} `(tenant, environment, name)` collision.
 */
export async function createWebWidgetChannel(
  ctx: TenantContext,
  input: CreateWebWidgetChannelRequest,
): Promise<ChannelRow> {
  const existing = await findChannelByName(ctx, input.environment, input.name);
  if (existing) throw new ChannelNameDuplicateError(input.name);

  const publicKey = generateChannelPublicKey();
  const id = await insertChannel(ctx, {
    type: "WebWidget",
    name: input.name,
    environment: input.environment,
    config: (input.config as Record<string, unknown>) ?? {},
    publicKey,
  });

  return (await findChannelById(ctx, id)) as ChannelRow;
}
