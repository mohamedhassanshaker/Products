import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deployment phase: standalone output lets the Docker runtime stage ship only
  // `.next/standalone` + `.next/static` + `public/` instead of the full monorepo
  // node_modules/source tree. `outputFileTracingRoot` points at the pnpm workspace
  // root so Next's file tracer can see (and correctly resolve) sibling workspace
  // packages consumed as TS source (see the `transpilePackages`/`serverExternalPackages`
  // comments below) instead of only this app's own directory.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  // @node-rs/argon2 (password.ts) ships a native .node binary — it must be resolved
  // via Node's own `require` at runtime, never webpack-bundled (webpack has no
  // loader for a native addon and shouldn't need one).
  serverExternalPackages: ["@node-rs/argon2"],
  // Workspace packages are consumed as TypeScript source (package.json "exports"
  // map to .ts/.tsx directly, LLD §2.1) — transpile them through Next's own
  // pipeline rather than requiring each to pre-build to JS.
  transpilePackages: [
    "@nextbot/contracts",
    "@nextbot/db",
    "@nextbot/tenancy",
    "@nextbot/iam",
    "@nextbot/connectors",
    "@nextbot/tool-registry",
    "@nextbot/channels",
    "@nextbot/ui",
    "@nextbot/secrets",
    "@nextbot/mcp-client",
  ],
  webpack(config, { isServer }) {
    // The workspace-wide convention (NodeNext/tsc resolution, per
    // docs/plans/nextbot-plan.md's dispatch #1 notes) is `.js`-suffixed relative
    // imports against `.ts`/`.tsx` source — correct for `tsc`/Node's ESM resolver,
    // but webpack resolves module specifiers against literal file existence and
    // doesn't apply that remapping by default. `resolve.extensionAlias` teaches it
    // to try `.ts`/`.tsx` (then real `.js`) whenever a specifier ends in `.js`,
    // which is what makes every `transpilePackages` entry above resolvable at all.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    if (isServer) {
      // `serverExternalPackages` alone didn't keep webpack from tracing through
      // @node-rs/argon2's platform-specific native-binary subpackage (it ships a
      // real `.node` file, which webpack has no loader for and must never try to
      // bundle) — pushing it into webpack's own `externals` list is the reliable
      // fix regardless of how `transpilePackages` interacts with that option.
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...externals, "@node-rs/argon2"];
    }
    return config;
  },
};

export default nextConfig;
