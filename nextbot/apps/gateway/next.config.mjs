import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deployment phase: see apps/web/next.config.mjs's identical comment — standalone
  // output + a workspace-root file-tracing root for the Docker runtime stage.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  // Workspace packages are consumed as TypeScript source (package.json "exports"
  // map to .ts directly, LLD §2.1) — transpile them through Next's own pipeline
  // rather than requiring each to pre-build to JS. Mirrors apps/web/next.config.mjs.
  // Phase 16 (BL-09) addition: `@nextbot/escalations` (the new composition-root
  // dependency `turn-pipeline-adapter.ts` wires in) transitively pulls in
  // `@nextbot/iam` (only for its already-public `findUserById` read — see
  // `claim-escalation.ts`'s doc), which is what first requires this app to handle
  // `@node-rs/argon2`'s native binary the same way `apps/web` already does below.
  transpilePackages: [
    "@nextbot/contracts",
    "@nextbot/db",
    "@nextbot/tenancy",
    "@nextbot/channels",
    "@nextbot/conversations",
    "@nextbot/escalations",
    "@nextbot/iam",
  ],
  // @node-rs/argon2 (packages/modules/iam/src/domain/password.ts) ships a native
  // .node binary — it must be resolved via Node's own `require` at runtime, never
  // webpack-bundled (webpack has no loader for a native addon and shouldn't need
  // one). Mirrors apps/web/next.config.mjs's identical, already-verified fix.
  serverExternalPackages: ["@node-rs/argon2"],
  webpack(config, { isServer }) {
    // Same workspace-wide `.js`-suffixed-import-against-`.ts`-source convention as
    // apps/web (see its next.config.mjs comment) — teaches webpack to resolve a
    // `.js` specifier against real `.ts`/`.tsx` source first.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    if (isServer) {
      // `serverExternalPackages` alone didn't keep webpack from tracing through
      // @node-rs/argon2's platform-specific native-binary subpackage on apps/web
      // either — pushing it into webpack's own `externals` list is the reliable
      // fix there, reused here verbatim.
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...externals, "@node-rs/argon2"];
    }
    return config;
  },
};

export default nextConfig;
