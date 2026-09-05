/**
 * QA Final Review minor item — `GET /connectors/<non-uuid>` (and any other
 * `[id]` route that passes a route param straight into a `uuid`-typed DB
 * column) previously threw an unhandled Postgres "invalid input syntax for
 * type uuid" error for a malformed id, surfacing as a generic 500 rather than
 * a clean 404. Route handlers/Server Components should check this before
 * querying and treat a non-UUID id the same as "not found."
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
