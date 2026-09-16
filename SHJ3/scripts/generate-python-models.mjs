#!/usr/bin/env node
/**
 * Generate `apps/ai`'s SQLAlchemy models from the Prisma schema.
 *
 * ADR-0005: **Prisma owns the SQL Server schema. Alembic is not used.** Two ORMs
 * pointed at one database is the most reliable way to corrupt a schema, so there
 * is one owner and the other side is generated.
 *
 * `shj3-ai` reads agent config, flow definitions, guardrail policies, tool
 * bindings and retrieval settings, and writes exactly three table groups
 * (conversation turns, orchestration traces, re-index job status) — enforced by
 * a database grant rather than by convention (ADR-0005 rule 5). The models below
 * describe the whole schema so reads are typed; the write restriction is the
 * database's job.
 *
 * The generated file carries a do-not-edit header, and
 * `scripts/gates/prisma-sqlalchemy-drift.mjs` re-runs this generator and fails on
 * a non-empty diff. With no CI (ADR-0008) that hook is the only thing standing
 * between a schema change and a runtime failure that only affects some tenants
 * (RISK-011 × RISK-014).
 *
 * ## Two schema files, one Python model set (ADR-0011)
 *
 * `shj3-web`'s Prisma side is two schema files — `prisma/platform/schema.prisma`
 * and `prisma/tenant/schema.prisma` — split so `getTenantDb()` can address N
 * dynamically created tenant schemas without Prisma's `multiSchema` feature
 * hard-coding a schema name at generate time (see either file's header comment,
 * or ADR-0011 directly). `shj3-ai`'s read access spans both halves, so this
 * generator reads both files via `getDMMF` and merges their models into ONE
 * coherent Python model set — the split is a `shj3-web`-side generated-client
 * concern, invisible on the SQLAlchemy side.
 */

// @prisma/internals ships as CommonJS, so the named export is not reachable
// through an ESM named import. Default-import the module object instead.
import prismaInternals from "@prisma/internals";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const { getDMMF } = prismaInternals;

const ROOT = resolve(import.meta.dirname, "..");
const PLATFORM_SCHEMA_PATH = resolve(ROOT, "prisma/platform/schema.prisma");
const TENANT_SCHEMA_PATH = resolve(ROOT, "prisma/tenant/schema.prisma");
const OUT_PATH = resolve(ROOT, "apps/ai/src/shj3_ai/adapters/outbound/sql/_generated_models.py");

/** Prisma scalar → SQLAlchemy type, with the SQL Server specifics that matter. */
const TYPE_MAP = {
  String: "String",
  Boolean: "Boolean",
  Int: "Integer",
  BigInt: "BigInteger",
  Float: "Float",
  Decimal: "Numeric",
  DateTime: "DateTime",
  Json: "JSON",
  Bytes: "LargeBinary",
};

/**
 * Prisma enums map to `String` rather than a Python Enum column: the database
 * enforces the vocabulary with a CHECK constraint (prisma/sql/001_constraints.sql),
 * and the generated `*_VALUES` tuples give Python the same list to validate
 * against without coupling the ORM mapping to it.
 */
function pythonType(field) {
  if (field.kind === "enum") return "String";
  return TYPE_MAP[field.type] ?? "String";
}

function annotation(field) {
  const base =
    field.kind === "enum"
      ? "str"
      : ({
          String: "str",
          Boolean: "bool",
          Int: "int",
          BigInt: "int",
          Float: "float",
          Decimal: "Decimal",
          DateTime: "datetime",
          Json: "Any",
          Bytes: "bytes",
        }[field.type] ?? "str");
  return field.isRequired && !field.isList ? base : `Optional[${base}]`;
}

/** snake_case for Python attribute names; the DB column keeps Prisma's name. */
function snake(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

// Each schema file is a complete, self-contained Prisma project (its own
// `datasource`/`generator` block), so `getDMMF` is called once per file rather
// than on their concatenated text — Prisma rejects a datamodel with more than
// one `datasource` block. The two DMMFs are merged below; `platform` and
// `tenant_template` model names are disjoint, so there is nothing to reconcile.
const platformDmmf = await getDMMF({ datamodel: readFileSync(PLATFORM_SCHEMA_PATH, "utf8") });
const tenantDmmf = await getDMMF({ datamodel: readFileSync(TENANT_SCHEMA_PATH, "utf8") });

const enums = new Map(
  [...platformDmmf.datamodel.enums, ...tenantDmmf.datamodel.enums].map((e) => [
    e.name,
    e.values.map((v) => v.name),
  ]),
);

const lines = [];

lines.push('"""');
lines.push("SQLAlchemy models for SHJ3 — GENERATED FILE, DO NOT EDIT.");
lines.push("");
lines.push("Generated from prisma/platform/schema.prisma and prisma/tenant/schema.prisma by");
lines.push("scripts/generate-python-models.mjs (ADR-0011 split the Prisma schema in two; this");
lines.push("generator reads both and merges them into one Python model set).");
lines.push("");
lines.push("Prisma owns the SQL Server schema and all migrations (ADR-0005). Editing this");
lines.push("file by hand will be reverted by the next generation, and the pre-commit drift");
lines.push("check will fail the commit. To change the schema, edit prisma/platform/schema.prisma");
lines.push("or prisma/tenant/schema.prisma.");
lines.push("");
lines.push("Write access: shj3-ai holds SELECT on everything and INSERT/UPDATE on exactly");
lines.push("three table groups — conversation turns, orchestration traces and re-index job");
lines.push("status. That restriction is a database grant, not a property of these classes");
lines.push("(ADR-0005 rule 5), so a mistake here fails at the database rather than silently");
lines.push("corrupting configuration.");
lines.push("");
lines.push("Tenant schemas: models declared against `tenant_template` describe the shape of");
lines.push("every tenant's schema. At runtime the session is bound to one tenant's schema");
lines.push("(ADR-0002), so an unqualified query reads that tenant and no other.");
lines.push('"""');
lines.push("");
lines.push("# ruff: noqa: E501");
lines.push("from __future__ import annotations");
lines.push("");
lines.push("from datetime import datetime");
lines.push("from decimal import Decimal");
lines.push("from typing import Any, Optional");
lines.push("");
lines.push("from sqlalchemy import (");
lines.push("    JSON,");
lines.push("    BigInteger,");
lines.push("    Boolean,");
lines.push("    DateTime,");
lines.push("    Float,");
lines.push("    Integer,");
lines.push("    LargeBinary,");
lines.push("    Numeric,");
lines.push("    String,");
lines.push(")");
lines.push("from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column");
lines.push("");
lines.push("");
lines.push("class Base(DeclarativeBase):");
lines.push('    """Declarative base for every generated model."""');
lines.push("");
lines.push("");

// Enum value tuples, so Python can validate against the same vocabulary the
// database CHECK constraints enforce.
if (enums.size > 0) {
  lines.push("# --------------------------------------------------------------------------");
  lines.push("# Enum vocabularies. The database enforces these via CHECK constraints in");
  lines.push("# prisma/sql/001_constraints.sql; these tuples let Python validate before a");
  lines.push("# round trip rather than after one.");
  lines.push("# --------------------------------------------------------------------------");
  lines.push("");
  for (const [name, values] of [...enums].sort(([a], [b]) => a.localeCompare(b))) {
    const items = values.map((v) => `"${v}"`).join(", ");
    lines.push(`${snake(name).toUpperCase()}_VALUES: tuple[str, ...] = (${items})`);
  }
  lines.push("");
  lines.push("");
}

const models = [...platformDmmf.datamodel.models, ...tenantDmmf.datamodel.models].sort((a, b) =>
  a.name.localeCompare(b.name),
);

for (const model of models) {
  const schema = model.schema ?? "tenant_template";
  const tableName = model.dbName ?? model.name;

  lines.push(`class ${model.name}(Base):`);
  lines.push(`    """${schema}.${tableName}"""`);
  lines.push("");
  lines.push(`    __tablename__ = "${tableName}"`);
  // The schema is intentionally NOT hardcoded for tenant tables: the session
  // binds it per tenant. Platform tables are fixed.
  if (schema === "platform") {
    lines.push(`    __table_args__ = {"schema": "platform"}`);
  } else {
    lines.push("    # Schema bound per tenant at session creation (ADR-0002); not fixed here.");
  }
  lines.push("");

  const scalars = model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");

  for (const field of scalars) {
    const attr = snake(field.name);
    const sqlType = pythonType(field);
    const ann = annotation(field);

    const parts = [sqlType === "String" ? "String(4000)" : sqlType];
    if (field.isId) parts.push("primary_key=True");
    if (!field.isRequired) parts.push("nullable=True");
    else if (!field.isId) parts.push("nullable=False");
    if (field.name !== attr) parts.push(`name="${field.name}"`);

    lines.push(`    ${attr}: Mapped[${ann}] = mapped_column(${parts.join(", ")})`);
  }

  if (scalars.length === 0) {
    lines.push("    pass");
  }

  lines.push("");
  lines.push("");
}

lines.push("__all__ = [");
lines.push('    "Base",');
for (const model of models) lines.push(`    "${model.name}",`);
lines.push("]");
lines.push("");

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, lines.join("\n"), "utf8");

console.log(
  `Generated ${models.length} model(s) → apps/ai/src/shj3_ai/adapters/outbound/sql/_generated_models.py`,
);
