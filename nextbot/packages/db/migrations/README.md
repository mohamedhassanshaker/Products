# Migrations

Plain, hand-authored SQL files applied in filename order by
`src/bootstrap/run-sql-migrations.ts` (tracked in a `_migrations_applied` table). RLS
enablement is not expressible in Drizzle's schema DSL, so migrations are hand-authored
end to end here rather than split between drizzle-kit-generated table DDL and a
bolted-on RLS file — one file per logical change, reviewed as a unit.

`packages/db/src/schema/*.ts` (the Drizzle schema) is the source of truth for
TypeScript types and query building; these `.sql` files are the source of truth for
what is actually applied to a database. Keep them in sync by hand when a table
changes — `drizzle-kit generate --custom` can still be used to scaffold a new file's
skeleton if useful, but its auto-inferred DDL is not used verbatim because it cannot
express the RLS statements that must ship in the same migration (LLD §3.2 rule 1).
