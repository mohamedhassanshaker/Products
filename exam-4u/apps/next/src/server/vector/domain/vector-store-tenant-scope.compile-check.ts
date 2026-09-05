import type { TenantScope, VectorStorePort } from './vector-store.port';

/**
 * Compile-time-only fixture (never imported by, or executed as part of, any runtime code path) —
 * the migration plan Phase 5 exit-gate-adjacent proof: "assert the adapter rejects a scope-less call
 * at compile time (a `@ts-expect-error` test)", ported from
 * `legacy/api/src/vector/domain/vector-store-tenant-scope.compile-check.ts`. Type-checked by the
 * real `tsc -p tsconfig.json --noEmit` run (`npm run typecheck`) since it lives under the main `src`
 * tree and is not a `.test.ts` file — unlike vitest (which transpiles per-file and does not evaluate
 * `@ts-expect-error` the same way a full program check does), a plain `tsc --noEmit` invocation
 * performs full type-checking regardless, so this fixture is a genuine, CI-enforced compile check,
 * not a self-fulfilling assertion.
 */
declare const port: VectorStorePort;
declare const queryVector: number[];
declare const scope: TenantScope;

// @ts-expect-error — TenantScope is VectorStorePort's mandatory first argument; a caller cannot
// express a scope-less query at all. If this line ever stops being a type error (e.g. a future
// refactor makes `scope` optional), `@ts-expect-error` becomes "unused" and TypeScript itself flags
// *that* as an error, failing `npm run typecheck`.
void port.searchChunks(queryVector, {}, 10);

// Positive control: the identical call *with* a scope compiles with zero errors — proves the line
// above fails for the right reason (a missing TenantScope), not an unrelated typo in the fixture.
void port.searchChunks(scope, queryVector, {}, 10);
