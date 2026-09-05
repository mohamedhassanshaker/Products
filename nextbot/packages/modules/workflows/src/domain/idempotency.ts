import { createHash } from "node:crypto";
import type { JsonValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, **FR-WF-04**, LLD §14.6.2) — the
 * idempotency key for a write-classified `ToolCall` node.
 *
 * **This module is the reason crash-resume is safe, and it is worth being explicit
 * about why.** The resume protocol's guarantee is "a crash mid-node re-executes at most
 * one node — and every write-classified node carries an idempotency key (FR-WF-04), so
 * re-execution is safe". That second clause is only true if the key a re-execution
 * produces is **byte-identical** to the key the crashed attempt produced. A key derived
 * from `crypto.randomUUID()` at dispatch time would be a *different* key on the retry,
 * the downstream tool would see a brand-new request, and the write would be applied
 * twice — the exact defect the guarantee claims to prevent.
 *
 * So every strategy below is a pure function of durable facts (the run id, the authored
 * node id, the loop iteration, the resolved args). Nothing here reads a clock, a
 * counter, or a random source. That is the whole design constraint, and it is what
 * `workflow-crash-resume.int.test.ts` asserts against the real downstream side effect
 * rather than against "a key was passed".
 *
 * Phase 15's V5 already guarantees at save time that every `rw_class = 'Write'` tool
 * node declares BOTH an `idempotency` strategy and a `compensation` action, so this is
 * never asked to invent a strategy for a write node.
 */

export type IdempotencyStrategy = "RunScopedUuid" | "DerivedFromArgs" | "CallerSupplied";

export interface IdempotencyContext {
  runId: string;
  nodeId: string;
  /** Loop iteration index; 0 outside a loop. Included so the SAME write node inside a
   *  loop produces a DIFFERENT key per iteration — otherwise iteration 2 would be
   *  deduplicated against iteration 1 and silently skipped, which is a data-loss bug
   *  rather than a safety one. */
  iteration: number;
  /** The resolved (pre-masking) args, used by `DerivedFromArgs`. */
  args: Record<string, JsonValue>;
  /** The `idempotency.argPath` the author declared, used by `CallerSupplied`. */
  argPath?: string | undefined;
}

/** Deterministic JSON canonicalization: object keys sorted at every depth, so two
 *  structurally identical arg objects that happened to be built in a different key
 *  order hash to the same value. Without this, `DerivedFromArgs` would be
 *  order-sensitive and a re-execution that rebuilt the args map in a different order
 *  would produce a different key — reintroducing the very bug this module exists to
 *  prevent. */
function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k] as JsonValue)}`).join(",")}}`;
}

/** Formats a sha256 digest as a canonical v4-shaped UUID string. `tool_call.
 *  idempotency_key` is a `uuid` column, so a free-form hash string would not persist;
 *  shaping the digest keeps the key both deterministic AND storable, which a random
 *  UUID would give up on the first half. */
function digestToUuid(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex");
  const v4 = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return v4;
}

/**
 * Computes the idempotency key for one dispatch of a write node.
 *
 * @param strategy the authored `idempotency.strategy`.
 * @param context the durable facts the key is derived from.
 * @returns a deterministic, UUID-shaped key. **Calling this twice with the same
 *   context always returns the same string** — that invariant is directly unit-tested,
 *   because everything about crash-safety rests on it.
 *
 * Strategy semantics:
 *  - `RunScopedUuid` — unique per `(run, node, iteration)`. The default choice: a
 *    retry of the same node position deduplicates, a genuinely different position does
 *    not. Note the name means "a UUID scoped to this run", not "a UUID generated at
 *    random during this run".
 *  - `DerivedFromArgs` — unique per `(run, node, iteration, canonical args)`. For tools
 *    whose backend deduplicates on payload equality; a retry with identical args
 *    deduplicates, and a loop iteration that produced different args does not collide.
 *  - `CallerSupplied` — the author points `argPath` at a field the upstream data
 *    already carries (an order id, an external request id). Falls back to
 *    `RunScopedUuid`'s derivation when the path does not resolve, rather than
 *    generating a random key: an unresolvable path must degrade to a still-deterministic
 *    key, never to an unsafe one.
 */
export function computeIdempotencyKey(strategy: IdempotencyStrategy, context: IdempotencyContext): string {
  const position = `${context.runId}:${context.nodeId}:${context.iteration}`;
  switch (strategy) {
    case "DerivedFromArgs":
      return digestToUuid(`${position}:args:${canonicalize(context.args)}`);
    case "CallerSupplied": {
      const supplied = context.argPath ? readArgPath(context.args, context.argPath) : undefined;
      if (supplied === undefined || supplied === null) return digestToUuid(position);
      return digestToUuid(`${position}:supplied:${String(supplied)}`);
    }
    case "RunScopedUuid":
    default:
      return digestToUuid(position);
  }
}

/**
 * The compensating action's own key, derived from the key of the write it undoes.
 *
 * Separate from — but deterministically tied to — the forward key, so the compensation
 * pass is itself replay-safe: a `Compensating` run interrupted mid-unwind and resumed
 * re-issues the same compensating call with the same key, and the downstream tool
 * deduplicates it. Without this, a crash during compensation could double-refund.
 */
export function compensationIdempotencyKey(forwardKey: string): string {
  return digestToUuid(`compensate:${forwardKey}`);
}

/** Reads a dotted path out of the resolved args (`CallerSupplied`'s `argPath`). Uses
 *  `hasOwnProperty` at every hop so an authored path can never reach a prototype
 *  member. */
function readArgPath(args: Record<string, JsonValue>, argPath: string): JsonValue | undefined {
  const segments = argPath.replace(/^\$\./, "").split(".");
  let current: JsonValue | undefined = args as JsonValue;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, JsonValue>)[segment];
  }
  return current;
}
