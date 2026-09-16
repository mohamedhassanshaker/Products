/**
 * The inbound WhatsApp webhook's crypto — pure, no vendor imports, no I/O, testable without
 * any live infrastructure (api.md §10.1, §4.4).
 *
 * Every comparison here is constant-time (`crypto.timingSafeEqual`), never `===` — a
 * variable-time compare on a secret-derived value is exactly the class of bug this route
 * exists to not have. `timingSafeEqual` itself throws on a length mismatch rather than
 * returning `false`, which is a real footgun for an unauthenticated caller who can supply any
 * length header — every function here guards that explicitly so a length mismatch is a
 * clean `false`, never an unhandled throw that could become a 500 on a hostile input.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time string equality, safe for two arbitrary-length, possibly-hostile inputs. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** `HMAC-SHA256(appSecret, rawBody)`, lower-case hex — computed over the exact raw bytes,
 *  never a re-serialized JSON string (a re-serialization can byte-for-byte differ from what
 *  Meta actually signed: key order, whitespace, unicode escaping). */
export function computeHmacSha256Hex(appSecret: string, rawBody: Buffer): string {
  return createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

const SIGNATURE_HEADER_PREFIX = "sha256=";

/**
 * Verify Meta's `X-Hub-Signature-256: sha256=<hex>` header against the raw request body.
 * Missing header, malformed prefix, or a length/content mismatch are all a clean `false` —
 * never a thrown exception a caller could turn into an unhandled-error information leak.
 */
export function verifyMetaSignatureHeader(
  headerValue: string | undefined | null,
  rawBody: Buffer,
  appSecret: string,
): boolean {
  if (!headerValue || !headerValue.startsWith(SIGNATURE_HEADER_PREFIX)) return false;
  const suppliedHex = headerValue.slice(SIGNATURE_HEADER_PREFIX.length);
  const expectedHex = computeHmacSha256Hex(appSecret, rawBody);
  return timingSafeEqualStrings(suppliedHex.toLowerCase(), expectedHex);
}

/** Meta's `GET` subscription-verification handshake: `hub.verify_token` must match, in
 *  constant time, never logged (the supplied token is a caller-controlled value, and never
 *  worth learning even a partial timing signal about). */
export function verifyHubVerifyToken(suppliedToken: string | null, expectedToken: string): boolean {
  if (!suppliedToken) return false;
  return timingSafeEqualStrings(suppliedToken, expectedToken);
}
