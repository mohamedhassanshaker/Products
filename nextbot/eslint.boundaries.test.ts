import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression test for QA Defect 2: `eslint-plugin-boundaries`'s `boundaries/element-types`
 * rule, by default, only inspects plain `import` statements (see the `boundaries/
 * dependency-nodes` setting added to `eslint.config.mjs`). A module -> module boundary
 * violation expressed as a re-export (`export * from "..."` or `export { x } from "..."`)
 * was therefore invisible to `pnpm lint:boundaries`, even though the equivalent plain
 * `import` was correctly flagged — silently defeating the "anything not in
 * MODULE_ALLOW_LIST is forbidden" guarantee LLD §2.3 makes.
 *
 * This reproduces QA's exact repro steps against a real, disallowed module edge
 * (`tenancy` -> `iam`; `tenancy`'s entry in MODULE_ALLOW_LIST is empty) for both
 * re-export forms, plus the already-working plain-`import` case as a control, and
 * asserts `eslint` (invoked the same way `pnpm run lint:boundaries` does) reports a
 * `boundaries/element-types` violation for all three. Fixture files are written to a
 * real path under `packages/modules/tenancy/src` (so the boundaries plugin resolves a
 * `module`/`tenancy` element type for them) and removed in a `finally` block so a
 * failing assertion can never leave a real lint violation behind for the actual
 * `lint:boundaries` gate to trip over.
 */
describe("eslint-plugin-boundaries catches disallowed module edges via re-exports (QA Defect 2 regression)", () => {
  const repoRoot = path.resolve(import.meta.dirname);
  const fixtureDir = path.resolve(repoRoot, "packages/modules/tenancy/src");

  /**
   * Writes `content` to a uniquely-named fixture file under the tenancy module,
   * lints just that file with the project's real ESLint config (via `pnpm exec
   * eslint`, matching how `lint:boundaries` invokes it), and returns whether a
   * `boundaries/element-types` violation was reported. Always deletes the fixture
   * file afterward, even if linting throws.
   */
  function lintFixture(fileName: string, content: string): { violated: boolean; output: string } {
    const fixturePath = path.join(fixtureDir, fileName);
    fs.writeFileSync(fixturePath, content);
    try {
      const relativePath = path.relative(repoRoot, fixturePath).split(path.sep).join("/");
      const result = spawnSync("pnpm", ["exec", "eslint", relativePath, "--max-warnings=0"], {
        cwd: repoRoot,
        shell: true,
        encoding: "utf8",
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      return { violated: result.status !== 0 && output.includes("boundaries/element-types"), output };
    } finally {
      fs.unlinkSync(fixturePath);
    }
  }

  it(
    "flags `export * from` a disallowed module",
    () => {
      const { violated, output } = lintFixture(
        "__qa_defect2_fixture_star__.ts",
        'export * from "@nextbot/iam";\n',
      );
      expect(violated, `expected a boundaries/element-types violation, got:\n${output}`).toBe(true);
    },
    30_000,
  );

  it(
    "flags `export { x } from` a disallowed module",
    () => {
      const { violated, output } = lintFixture(
        "__qa_defect2_fixture_named__.ts",
        'export { something } from "@nextbot/iam";\n',
      );
      expect(violated, `expected a boundaries/element-types violation, got:\n${output}`).toBe(true);
    },
    30_000,
  );

  it(
    "(control) still flags a plain `import` from a disallowed module",
    () => {
      const { violated, output } = lintFixture(
        "__qa_defect2_fixture_import__.ts",
        'import type { Something } from "@nextbot/iam";\nexport type { Something };\n',
      );
      expect(violated, `expected a boundaries/element-types violation, got:\n${output}`).toBe(true);
    },
    30_000,
  );
});
