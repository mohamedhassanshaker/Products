import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta signs every webhook delivery with `X-Hub-Signature-256: sha256=<hex hmac>` —
 * the identical scheme GitHub uses for its own webhooks (both follow the same
 * `hub.*` convention Meta originated). This is a deliberate, direct port of
 * `packages/modules/agent-platform`'s already-correct `verifyHmacSignature` (Git
 * webhooks, ADR-0009) rather than a reimplementation — same algorithm, same
 * constant-time comparison, same "never trusts the payload before verifying"
 * discipline — duplicated here (not imported) because `channel-adapters` has no
 * allowed dependency edge to `agent-platform` and the function is a five-line
 * primitive, not worth inventing a new shared-crypto package for.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return constantTimeEquals(expected, signatureHeader);
}

function constantTimeEquals(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
