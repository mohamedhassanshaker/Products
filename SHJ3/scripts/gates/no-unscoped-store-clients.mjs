#!/usr/bin/env node
/**
 * Gate: no unscoped store clients.
 *
 * ADR-0002 rule 3, and the single most important structural control in the
 * system. Tenant isolation is not meant to be remembered — it is meant to be
 * *unexpressible*. Application code is given `getTenantDb()`, `getTenantGraph()`,
 * `getTenantVectors()` and `getTenantCache()`, and no raw client, so there is no
 * vocabulary in which to write a cross-tenant query.
 *
 * A tenant here is a Sharjah government entity. A cross-tenant leak is a
 * confidentiality breach in a government service, not a defect, so the control
 * is mechanical rather than advisory.
 *
 * This gate enforces two things:
 *   1. Store clients are constructed only inside their designated adapter.
 *   2. No module re-exports a raw client under any name.
 */

import { resolve, relative } from "node:path";
import { collectFiles, read, toPosix, report, matchLines } from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/**
 * Where each client may legitimately be constructed. Everything else must go
 * through the tenant-scoped factory.
 */
const CONSTRUCTORS = [
  {
    id: "prisma",
    // ADR-0011: two Prisma schema files means two generated clients, imported into
    // tenant-db.ts under aliases (`PlatformPrismaClient` / `TenantPrismaClient`) so they
    // don't collide — `\w*` keeps the match on `new <anything>PrismaClient(`, not just the
    // unaliased name, so an alias can never be a quiet way around this gate.
    pattern: /new\s+\w*PrismaClient\s*\(/,
    allowed: ["apps/web/src/modules/platform/adapters/outbound/sql/"],
  },
  {
    id: "neo4j-driver",
    pattern: /neo4j\.driver\s*\(|GraphDatabase\.driver\s*\(|AsyncGraphDatabase\.driver\s*\(/,
    allowed: ["apps/ai/src/shj3_ai/adapters/outbound/graph/"],
  },
  {
    id: "qdrant",
    pattern: /new\s+QdrantClient\s*\(|QdrantClient\s*\(/,
    allowed: ["apps/ai/src/shj3_ai/adapters/outbound/vector/"],
  },
  {
    id: "redis",
    pattern: /createClient\s*\(|Redis\.from_url\s*\(|new\s+Redis\s*\(/,
    allowed: [
      "apps/web/src/modules/platform/adapters/outbound/cache/",
      "apps/ai/src/shj3_ai/adapters/outbound/cache/",
    ],
  },
  {
    id: "sqlalchemy-engine",
    pattern: /create_async_engine\s*\(|create_engine\s*\(/,
    allowed: ["apps/ai/src/shj3_ai/adapters/outbound/sql/"],
  },
];

/**
 * Re-exporting a raw client defeats the constructor rule, so it is banned
 * everywhere including inside the adapters. The adapter exports factories.
 */
const RAW_EXPORT =
  /export\s+(?:const|let|var|default)?\s*\{?\s*(prisma|prismaClient|db|driver|neo4jDriver|qdrant|qdrantClient|redis|redisClient|engine)\s*[,}=:]/;

const files = [
  ...collectFiles(resolve(ROOT, "apps"), [".ts", ".tsx", ".mts", ".py"]),
  ...collectFiles(resolve(ROOT, "packages"), [".ts", ".tsx", ".mts", ".py"]),
];

const findings = [];

for (const file of files) {
  const rel = toPosix(relative(ROOT, file));
  const isTest = rel.includes(".test.") || rel.includes(".spec.") || rel.includes("/tests/");
  const source = read(file);

  for (const c of CONSTRUCTORS) {
    if (c.allowed.some((a) => rel.startsWith(a))) continue;
    // Isolation and integration tests legitimately construct raw clients in
    // order to assert, from outside the application, that tenant A's data is
    // unreachable as tenant B. That assertion is the point of the suite.
    if (isTest) continue;

    for (const hit of matchLines(source, c.pattern)) {
      if (/^\s*(\/\/|\/\*|\*|#)/.test(hit.excerpt)) continue;
      findings.push({
        file: rel,
        line: hit.line,
        excerpt: hit.excerpt,
        note: `${c.id} client constructed outside ${c.allowed.join(" or ")}`,
      });
    }
  }

  if (isTest) continue;

  for (const hit of matchLines(source, RAW_EXPORT)) {
    if (/^\s*(\/\/|\/\*|\*|#)/.test(hit.excerpt)) continue;
    findings.push({
      file: rel,
      line: hit.line,
      excerpt: hit.excerpt,
      note: "raw store client re-exported — export a tenant-scoped factory instead",
    });
  }
}

const code = report({
  gate: "no-unscoped-store-clients",
  rule: "Store clients are constructed only in their adapter, and never re-exported raw (ADR-0002 rule 3)",
  findings,
  hint:
    "Use getTenantDb() / getTenantGraph() / getTenantVectors() / getTenantCache().\n" +
    "  These read the request-scoped tenant context and return handles that are already\n" +
    "  scoped, so a cross-tenant query cannot be written. If you need a new operation,\n" +
    "  add it to the port rather than reaching for the client.",
});

process.exit(code);
