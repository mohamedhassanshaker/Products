import type { ArtifactKind } from "./artifact-kind.js";
import type { Change, ChangeSet } from "./change-set.js";
import { resolveArrayDiffMode } from "./keyed-array-config.js";
import { isSecurityRelevantPath } from "./security-tags.js";

/** True for a plain JSON-object-shaped value (not an array, not null) — the only
 * shape this engine recurses into key-by-key. Everything else (arrays, scalars) is
 * handled by its own branch in `diffValue`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality — order-independent for object keys (a reordered mapping is
 * never a change, ADR-0016 §2.1), order-*dependent* for arrays (array order is only
 * ever ignored when `keyed-array-config.ts` explicitly says so for that path). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function pushChange(out: Change[], kind: ArtifactKind, entry: Omit<Change, "securityRelevant">) {
  out.push({ ...entry, securityRelevant: isSecurityRelevantPath(kind, entry.path) });
}

/** Diffs a semantically-keyed array (ADR-0016 §2.1) by `keyField`, never by position:
 * exported directly (alongside `diffSetArray`) so this package's own unit tests can
 * exercise the keyed/set algorithms in isolation, independent of which real
 * `ArtifactKind` schemas happen to have a keyed array today.
 * a member present in both sides (matched by key) is recursed into for a `changed`
 * diff of its own fields; a member only in `right` is `added`; a member only in
 * `left` is `removed`. The path for a matched member's own changes is
 * `${path}[${keyValue}]`, e.g. `spec.nodes[node-3].tier`. */
export function diffKeyedArray(kind: ArtifactKind, path: string, keyField: string, left: unknown[], right: unknown[], out: Change[]) {
  const keyOf = (item: unknown): string | undefined => (isPlainObject(item) ? (item[keyField] as string | undefined) : undefined);
  const leftByKey = new Map(left.map((item) => [keyOf(item), item]));
  const rightByKey = new Map(right.map((item) => [keyOf(item), item]));

  for (const [key, rightItem] of rightByKey) {
    if (key === undefined) continue;
    if (!leftByKey.has(key)) {
      pushChange(out, kind, { op: "added", path: `${path}[${key}]`, after: rightItem });
    }
  }
  for (const [key, leftItem] of leftByKey) {
    if (key === undefined) continue;
    if (!rightByKey.has(key)) {
      pushChange(out, kind, { op: "removed", path: `${path}[${key}]`, before: leftItem });
    } else {
      diffValue(kind, `${path}[${key}]`, leftItem, rightByKey.get(key), out);
    }
  }
}

/** Diffs an unordered set of primitive values (ADR-0016 §2.1 — a plain string list
 * with no per-element identity, e.g. capability-group names). Order never produces a
 * diff; only membership does. */
export function diffSetArray(kind: ArtifactKind, path: string, left: unknown[], right: unknown[], out: Change[]) {
  const leftSet = new Set(left.map((v) => JSON.stringify(v)));
  const rightSet = new Set(right.map((v) => JSON.stringify(v)));
  for (const raw of rightSet) {
    if (!leftSet.has(raw)) pushChange(out, kind, { op: "added", path, after: JSON.parse(raw) });
  }
  for (const raw of leftSet) {
    if (!rightSet.has(raw)) pushChange(out, kind, { op: "removed", path, before: JSON.parse(raw) });
  }
}

function diffValue(kind: ArtifactKind, path: string, left: unknown, right: unknown, out: Change[]): void {
  if (deepEqual(left, right)) return;

  if (left === undefined && right !== undefined) {
    pushChange(out, kind, { op: "added", path, after: right });
    return;
  }
  if (left !== undefined && right === undefined) {
    pushChange(out, kind, { op: "removed", path, before: left });
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const mode = resolveArrayDiffMode(kind, path);
    if (mode.mode === "keyed") {
      diffKeyedArray(kind, path, mode.keyField, left, right, out);
    } else if (mode.mode === "set") {
      diffSetArray(kind, path, left, right, out);
    } else {
      // ADR-0016 §4's documented, deliberate degrade: noisy (one `changed` for the
      // whole array) but never silently wrong.
      pushChange(out, kind, { op: "changed", path, before: left, after: right });
    }
    return;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      diffValue(kind, path ? `${path}.${key}` : key, left[key], right[key], out);
    }
    return;
  }

  // Scalars, or a type change (e.g. a field that used to be a string and is now an
  // object) — either way, an unrecursable difference at this exact path.
  pushChange(out, kind, { op: "changed", path, before: left, after: right });
}

/** ADR-0016's public structural-diff entry point over two already-*parsed* documents
 * (not YAML text) — `diffArtifact` (`index.ts`) is the YAML-text-in, kind-aware
 * public API; this is the pure, format-agnostic engine underneath it. Security-
 * relevant changes are sorted first (ADR-0016 §2.1's review-surface requirement),
 * ties broken by path for a stable, deterministic order. */
export function diffParsedArtifact(kind: ArtifactKind, left: unknown, right: unknown): ChangeSet {
  const out: Change[] = [];
  diffValue(kind, "", left, right, out);
  return out.sort((a, b) => {
    if (a.securityRelevant !== b.securityRelevant) return a.securityRelevant ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}
