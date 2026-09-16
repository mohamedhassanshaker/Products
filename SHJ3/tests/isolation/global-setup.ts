/**
 * Vitest `globalSetup` for the `isolation` project (`vitest.config.ts`).
 *
 * Runs exactly once per invocation of `vitest run --project isolation`, before any spec
 * file in the project, regardless of which files are selected — which is what makes it the
 * right place for two-tenant, four-store provisioning rather than a per-file `beforeAll`.
 * See `setup.ts`'s module comment for the full reasoning. This file is deliberately thin:
 * all the fixture logic lives in `setup.ts` so it stays unit-testable-by-reading rather than
 * entangled with Vitest's hook contract.
 */

import { destroyIsolationTenants, provisionIsolationTenants } from "./setup.js";

export default async function setup(): Promise<() => Promise<void>> {
  await provisionIsolationTenants();

  return async function teardown(): Promise<void> {
    await destroyIsolationTenants();
  };
}
