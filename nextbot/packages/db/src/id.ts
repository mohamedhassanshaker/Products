import { uuidv7 } from "uuidv7";

/**
 * Generates a UUIDv7 primary key, app-side, per LLD §3: "Primary keys are UUIDv7
 * (uuid column type, generated app-side by uuidv7() for index locality)". UUIDv7's
 * leading timestamp bits keep B-tree index inserts sequential (unlike UUIDv4), which
 * matters once `message`/`tool_call`-scale tables exist.
 */
export function generateId(): string {
  return uuidv7();
}
