import type { Budget, IdSet, ScopeDescriptor, ScopeOriginValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.2.1) — the
 * 16-dimension scope lattice's `⊤` (top, "no constraint") values and per-dimension
 * `∧` (meet) functions, transcribed verbatim from LLD §14.2.1's table.
 *
 * **Pure, I/O-free** (ADR-0012 §2.3) — no `@nextbot/db` import anywhere in this
 * file or `intersect.ts`, enforced additionally by dependency-cruiser's
 * `no-db-inside-domain` rule.
 *
 * Two invariants make "never unions, only narrows" (FR-ORC-02) structural rather
 * than a convention (LLD §14.2.1): every *allow*-shaped dimension's meet is either
 * set intersection or a `min`; every *deny*-shaped dimension's meet is either
 * union or a `max`. A reviewer checks this one file, not N call sites.
 */

/** Only the scope-bearing fields of `ScopeDescriptor` — everything the lattice
 * folds over. `origin`/`originId`/`originLabel` are metadata, not lattice values,
 * and are handled separately by `intersect.ts`. */
export type LatticeFields = Omit<ScopeDescriptor, "origin" | "originId" | "originLabel">;

export type DimensionName = keyof LatticeFields;

/**
 * The fully-resolved effective scope: every dimension concretely present — the
 * "narrowed scope the callee must execute under" the contract promises.
 *
 * Written out explicitly rather than derived via `NonNullable<LatticeFields[K]>`
 * for one reason: `minRequiredTier`'s `⊤` is `null` (LLD §14.2.1's table) — a
 * real, meaningful "no floor" value, not merely "absent" — while every other
 * dimension's `⊤` is a concrete non-null value once resolved. A blanket
 * `NonNullable` mapped type would incorrectly strip `null` from
 * `minRequiredTier` too (`§14.2.2`'s wire schema only says `Optional`, it never
 * spells out the `| null` variant §14.2.1 requires — a minor gap between the
 * conceptual table and the literal TypeBox schema; this type reconciles it in
 * the one place the fold logic actually needs the distinction).
 */
export interface EffectiveLattice {
  capabilityGroupIds: IdSet;
  toolIds: IdSet;
  deniedToolIds: string[];
  knowledgeCollectionIds: IdSet;
  channelTypes: "*" | string[];
  environments: "*" | string[];
  rwClasses: string[];
  autonomyCeiling: string;
  minRequiredTier: string | null;
  trustLevel: string;
  maskingFloor: Record<string, string>;
  allowOutOfRegionInference: boolean;
  refuseWhenUngrounded: boolean;
  minCitations: number;
  budget: Budget;
  piiContextsRequiringReeval: string[];
}

const APPROVAL_TIER_RANK: Record<string, number> = { Tier1: 1, Tier2: 2, Tier3: 3 };
export function tierRank(tier: string): number {
  const rank = APPROVAL_TIER_RANK[tier];
  if (rank === undefined) throw new Error(`Unknown approval tier '${tier}'`);
  return rank;
}

const TRUST_LEVEL_RANK: Record<string, number> = { Untrusted: 1, SemiTrusted: 2, Trusted: 3 };
function trustRank(level: string): number {
  const rank = TRUST_LEVEL_RANK[level];
  if (rank === undefined) throw new Error(`Unknown trust level '${level}'`);
  return rank;
}

const MASK_ACTION_RANK: Record<string, number> = { Show: 1, PartialMask: 2, FullMask: 3, Redact: 4 };
function maskRank(action: string): number {
  const rank = MASK_ACTION_RANK[action];
  if (rank === undefined) throw new Error(`Unknown mask action '${action}'`);
  return rank;
}

/** `⊤` — every dimension at "this level imposes no constraint" (LLD §14.2.1's
 * table, `⊤` column). The fold starts here (§14.2.3 step 1). */
export const TOP: EffectiveLattice = {
  capabilityGroupIds: "*",
  toolIds: "*",
  deniedToolIds: [],
  knowledgeCollectionIds: "*",
  channelTypes: "*",
  environments: "*",
  rwClasses: ["Read", "Write"],
  autonomyCeiling: "Tier3",
  minRequiredTier: null,
  trustLevel: "Trusted",
  maskingFloor: {},
  allowOutOfRegionInference: true,
  refuseWhenUngrounded: false,
  minCitations: 0,
  budget: {},
  piiContextsRequiringReeval: [],
};

/** `'*' ∧ ['a']` is `['a']`, never `'*'` (LLD §14.2.1 — a bounded top). Generic
 * over any `T extends string` id-set-shaped or star-or-array-shaped dimension
 * (`capabilityGroupIds`/`toolIds`/`knowledgeCollectionIds`/`channelTypes`/
 * `environments` all share this exact meet). Output is de-duplicated and sorted
 * so the fold is provably commutative/associative regardless of input order
 * (asserted by `intersect.test.ts`'s fold-order-independence property test). */
function meetStarOrArray<T extends string>(a: "*" | T[], b: "*" | T[]): "*" | T[] {
  if (a === "*") return b === "*" ? "*" : [...b].sort();
  if (b === "*") return [...a].sort();
  const bSet = new Set(b);
  return [...new Set(a.filter((x) => bSet.has(x)))].sort();
}

/** Deny-shaped: meet is **union** (deny only ever grows — `deniedToolIds`,
 * `piiContextsRequiringReeval`). */
function meetUnion<T extends string>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])].sort();
}

function meetIntersect<T extends string>(a: T[], b: T[]): T[] {
  const bSet = new Set(b);
  return [...new Set(a.filter((x) => bSet.has(x)))].sort();
}

function meetMinTier(a: string, b: string): string {
  return tierRank(a) <= tierRank(b) ? a : b;
}

/** `minRequiredTier`'s `⊤` is `null` ("no floor"); meet is `max`, with `null`
 * acting as the identity element (lowest possible floor) rather than a real tier. */
function meetMaxTierOrNull(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return tierRank(a) >= tierRank(b) ? a : b;
}

function meetMinTrust(a: string, b: string): string {
  return trustRank(a) <= trustRank(b) ? a : b;
}

/**
 * Per-context strictest wins (E10: `Redact > FullMask > PartialMask > Show`).
 * Exported (not just used internally by the fold below) so Target Architecture
 * Blueprint Phase 12 (BL-44, FR-AGT-14) can reuse the EXACT same "which action is
 * stricter" comparison to aggregate `pii_policy`'s per-`(entityType, trustLevel)`
 * matrix into one per-context floor value (`tenant-scope-policy-service.ts`) —
 * "exactly one notion of stricter in the codebase," never a second, independently
 * re-derived comparison.
 */
export function meetMaskingFloor(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...a };
  for (const [context, action] of Object.entries(b)) {
    const existing = result[context];
    result[context] = existing === undefined || maskRank(action) > maskRank(existing) ? action : existing;
  }
  return result;
}

function meetAnd(a: boolean, b: boolean): boolean {
  return a && b;
}

/** `refuseWhenUngrounded`'s meet is logical **OR** — deny-shaped in spirit
 * (stricter/`true` wins), `⊤` is `false`. */
function meetOr(a: boolean, b: boolean): boolean {
  return a || b;
}

function meetMaxNumber(a: number, b: number): number {
  return Math.max(a, b);
}

/** `undefined` is treated as `+∞` for every budget field (E9) — a level that
 * doesn't declare a field imposes no cap on it, not a zero cap. */
function meetBudgetField(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function meetBudget(a: Budget, b: Budget): Budget {
  return {
    usdPerTurn: meetBudgetField(a.usdPerTurn, b.usdPerTurn),
    seconds: meetBudgetField(a.seconds, b.seconds),
    maxSteps: meetBudgetField(a.maxSteps, b.maxSteps),
    maxDepth: meetBudgetField(a.maxDepth, b.maxDepth),
    maxFanOut: meetBudgetField(a.maxFanOut, b.maxFanOut),
    maxDelegations: meetBudgetField(a.maxDelegations, b.maxDelegations),
    maxHops: meetBudgetField(a.maxHops, b.maxHops),
    maxExpansions: meetBudgetField(a.maxExpansions, b.maxExpansions),
  };
}

/**
 * One row of LLD §14.2.1's table, as data — `intersect.ts`'s fold loop iterates
 * this array rather than hand-listing 16 field accesses, so adding/auditing a
 * dimension is a one-line change in exactly one place.
 */
export interface Dimension {
  name: DimensionName;
  meet: (a: unknown, b: unknown) => unknown;
}

export const DIMENSIONS: Dimension[] = [
  { name: "capabilityGroupIds", meet: (a, b) => meetStarOrArray(a as IdSet, b as IdSet) },
  { name: "toolIds", meet: (a, b) => meetStarOrArray(a as IdSet, b as IdSet) },
  { name: "deniedToolIds", meet: (a, b) => meetUnion(a as string[], b as string[]) },
  { name: "knowledgeCollectionIds", meet: (a, b) => meetStarOrArray(a as IdSet, b as IdSet) },
  { name: "channelTypes", meet: (a, b) => meetStarOrArray(a as "*" | string[], b as "*" | string[]) },
  { name: "environments", meet: (a, b) => meetStarOrArray(a as "*" | string[], b as "*" | string[]) },
  { name: "rwClasses", meet: (a, b) => meetIntersect(a as string[], b as string[]) },
  { name: "autonomyCeiling", meet: (a, b) => meetMinTier(a as string, b as string) },
  { name: "minRequiredTier", meet: (a, b) => meetMaxTierOrNull(a as string | null, b as string | null) },
  { name: "trustLevel", meet: (a, b) => meetMinTrust(a as string, b as string) },
  { name: "maskingFloor", meet: (a, b) => meetMaskingFloor(a as Record<string, string>, b as Record<string, string>) },
  { name: "allowOutOfRegionInference", meet: (a, b) => meetAnd(a as boolean, b as boolean) },
  { name: "refuseWhenUngrounded", meet: (a, b) => meetOr(a as boolean, b as boolean) },
  { name: "minCitations", meet: (a, b) => meetMaxNumber(a as number, b as number) },
  { name: "budget", meet: (a, b) => meetBudget(a as Budget, b as Budget) },
  { name: "piiContextsRequiringReeval", meet: (a, b) => meetUnion(a as string[], b as string[]) },
];

/** Cheap deep-equality for trace's "did this level actually narrow anything"
 * check — values here are always plain JSON-shaped (arrays/records/primitives),
 * so a canonicalised `JSON.stringify` comparison is exact and side-effect-free. */
export function latticeValuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalizeForCompare(a)) === JSON.stringify(canonicalizeForCompare(b));
}

function canonicalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForCompare);
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) result[key] = canonicalizeForCompare((value as Record<string, unknown>)[key]);
    return result;
  }
  return value;
}

export type { ScopeOriginValue };
