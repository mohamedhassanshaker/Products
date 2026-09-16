#!/usr/bin/env node
/**
 * Gate: the generated SQLAlchemy models match the Prisma schema.
 *
 * ADR-0005 rule 4. Two ORMs point at one SQL Server database — Prisma owns the
 * schema, SQLAlchemy reads it — and the only thing keeping them honest is that
 * the Python side is *generated* and this check refuses a commit where the
 * committed output differs from what the generator now produces.
 *
 * ## Why this is the most important of the four gates
 *
 * ADR-0008 declined CI, and RISK-011 × RISK-014 describe how that compounds
 * here. A `--no-verify` commit lands a schema change without regenerating the
 * models; separately, an N-tenant migration can partially apply and leave
 * government entities on divergent schemas. Together, `shj3-ai` ends up reading
 * columns that exist for some entities and not others — and the symptom is
 * conversations failing for one entity only, which is a genuinely hard thing to
 * diagnose from a support ticket.
 *
 * Defence in depth exists downstream (the AI image build re-asserts model
 * currency, and migration verification compares models against the live schema),
 * but nothing catches a local bypass. That is why this runs first and fails
 * loudly.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { report } from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
// ADR-0011: the Prisma schema is two files, not one — platform.schema.prisma keeps
// `multiSchema`; tenant/schema.prisma deliberately does not (see either file's header).
// generate-python-models.mjs reads and merges both; this gate only needs to know
// whether the schema is set up at all yet, so it is satisfied by either being present.
const PLATFORM_SCHEMA = resolve(ROOT, "prisma/platform/schema.prisma");
const TENANT_SCHEMA = resolve(ROOT, "prisma/tenant/schema.prisma");
const GENERATED = resolve(ROOT, "apps/ai/src/shj3_ai/adapters/outbound/sql/_generated_models.py");

if (!existsSync(PLATFORM_SCHEMA) && !existsSync(TENANT_SCHEMA)) {
  console.log("  skip gate:drift  (prisma/platform|tenant/schema.prisma not present yet)");
  process.exit(0);
}

const before = existsSync(GENERATED) ? readFileSync(GENERATED, "utf8") : null;

const proc = spawnSync("node", ["scripts/generate-python-models.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (proc.status !== 0) {
  console.error("\n  FAIL gate:drift — the model generator itself failed\n");
  console.error(proc.stdout ?? "");
  console.error(proc.stderr ?? "");
  console.error(
    "  The generator is build-critical infrastructure (ADR-0005 rule 4). Fix it before committing.\n",
  );
  process.exit(1);
}

const after = readFileSync(GENERATED, "utf8");

if (before === null) {
  process.exit(
    report({
      gate: "prisma-sqlalchemy-drift",
      rule: "Generated SQLAlchemy models must be committed alongside the schema (ADR-0005 rule 4)",
      findings: [
        {
          file: "apps/ai/src/shj3_ai/adapters/outbound/sql/_generated_models.py",
          line: 1,
          excerpt: "(file was missing and has now been generated)",
          note: "Stage the generated file with your schema change",
        },
      ],
      hint: "The generated models are part of the commit, not a build artefact. `git add` them.",
    }),
  );
}

if (before !== after) {
  // Report the first few differing lines: a diff of a 2,000-line generated file
  // is unhelpful, but the first divergence usually names the changed model.
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const findings = [];
  for (let i = 0; i < Math.max(beforeLines.length, afterLines.length) && findings.length < 8; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      findings.push({
        file: "apps/ai/src/shj3_ai/adapters/outbound/sql/_generated_models.py",
        line: i + 1,
        excerpt: `committed: ${beforeLines[i] ?? "(end of file)"}`,
        note: `regenerated: ${afterLines[i] ?? "(end of file)"}`,
      });
    }
  }

  process.exit(
    report({
      gate: "prisma-sqlalchemy-drift",
      rule: "The committed SQLAlchemy models must equal the generator's current output (ADR-0005 rule 4)",
      findings,
      hint:
        "The generator has already rewritten the file — review the change and stage it.\n" +
        "  Do not hand-edit the generated models: edit prisma/platform/schema.prisma or\n" +
        "  prisma/tenant/schema.prisma instead.\n" +
        "  This is the only protection against two ORMs disagreeing about one schema (RISK-011).",
    }),
  );
}

console.log("  ok   prisma-sqlalchemy-drift");
process.exit(0);
