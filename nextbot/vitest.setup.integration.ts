import { config } from "dotenv";
import path from "node:path";

// Integration/isolation test projects talk to the ephemeral Postgres/Redis stood up
// by `compose.test.yml`. Credentials for that stack live in `.env.test` (see
// `.env.test.example`) rather than being hardcoded into every test file.
config({ path: path.resolve(import.meta.dirname, ".env.test") });

// Target Architecture Blueprint Phase 7b (BL-38) — a single, STABLE (never mutated
// mid-run) upload-store root for every `@nextbot/knowledge` integration test.
// Deliberately set ONCE here rather than per-test-file `beforeAll`/`afterAll`
// juggling of `process.env.KNOWLEDGE_UPLOAD_STORE_ROOT`: when multiple `*.int.test.ts`
// files run concurrently, vitest can schedule them onto the SAME worker (sharing one
// `process.env`), so one file's `afterAll` restoring the var to its "original"
// (undefined) value mid-run raced against a SIBLING file's in-flight Ingest-stage
// read and made it resolve the wrong (default) directory — a real, reproduced bug
// (not a flake) this fixes structurally. Real isolation between tests/tenants
// already comes from `putUpload`/`getUpload`'s own per-tenant-id subdirectory, not
// from a distinct root per file, so a single fixed root for the whole run is correct
// and sufficient.
process.env.KNOWLEDGE_UPLOAD_STORE_ROOT ??= path.resolve(import.meta.dirname, ".data-test", "knowledge-uploads");
