import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/**
 * Absolute path to the workspace root (this config's own directory).
 *
 * `import/no-restricted-paths` resolves its zone `target`/`from` globs against
 * `process.cwd()` by default. Package `lint` scripts run ESLint from inside
 * `apps/*`, where workspace-root-relative zone paths match nothing and the rule
 * silently enforces nothing. Pinning `basePath` makes the zones hold no matter
 * which directory ESLint is invoked from.
 */
const workspaceRoot = dirname(fileURLToPath(import.meta.url));

/**
 * `apps/api` module names (LLD §3.4 bounded contexts). Used to generate the
 * per-module "reach me only through my index.ts barrel" restriction zones.
 * Add a new module here when one is introduced under `apps/api/src/modules`.
 */
const apiModules = [
  'admin-users',
  'auth',
  'platform',
  'tenants',
  'providers',
  'deployment-config',
  'transport',
  'sessions',
  'public',
  'internal',
  'jobs',
  'tools',
  'session-logs',
  'dashboard',
  'gpu',
  'alerts',
  'residency',
];

/**
 * `apps/web` lazy features per Angular project (LLD §3.4). Used to generate the
 * per-feature isolation zones. Add an entry when a new feature is introduced
 * under `projects/<project>/src/app/features`.
 */
const webFeatures = [
  { project: 'admin', feature: 'auth' },
  { project: 'admin', feature: 'deployments' },
  { project: 'admin', feature: 'provider-registry' },
  { project: 'admin', feature: 'agent-builder' },
  { project: 'conversation', feature: 'precall' },
  { project: 'conversation', feature: 'call' },
  { project: 'conversation', feature: 'summary' },
  { project: 'admin', feature: 'dashboard' },
  { project: 'admin', feature: 'session-logs' },
  { project: 'admin', feature: 'gpu' },
  { project: 'admin', feature: 'alerts' },
  { project: 'admin', feature: 'residency' },
  { project: 'admin', feature: 'tools' },
  { project: 'admin', feature: 'reasoning' },
  { project: 'admin', feature: 'knowledge' },
  { project: 'admin', feature: 'skills' },
  // Phase 14 (BL-052..057) introduced this feature without adding it here —
  // it had no isolation zone at all until now (any feature could reach into
  // it silently). Added as part of Phase 16's audit of every feature this
  // consolidation touches, on the same "every lazy feature gets a zone"
  // basis as its thirteen siblings above.
  { project: 'admin', feature: 'hitl' },
];

/**
 * Phase 16 (BL-061..065, `docs/v2/UX_SCOPE.md` "Builder consolidation") —
 * the `agent-builder` feature becomes a shell that composes these six
 * already-built features' page components directly as tab content
 * (`tenants/:id/builder/{tools,reasoning,knowledge,skills,hitl,residency}`)
 * instead of rewriting them. Every *other* feature must stay isolated from
 * each of these, same as before — only `agent-builder` is exempted from the
 * zone below, by narrowing that zone's `target` rather than by an `except`
 * on `from` (`no-restricted-paths`'s `except` carves exceptions out of
 * `from`, not `target`, so it cannot express "every feature but this one").
 */
const BUILDER_COMPOSED_FEATURES = ['tools', 'reasoning', 'knowledge', 'skills', 'hitl', 'residency'];

/**
 * Workspace ESLint: TypeScript recommended plus LLD §3.4 layer/module boundaries.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      '**/.angular/**',
      '**/node_modules/**',
    ],
  },
  {
    files: ['apps/api/**/*.ts'],
    plugins: { import: importPlugin },
    // eslint-plugin-import's bundled Node resolver only understands
    // .js/.json/.node, so without an explicit TypeScript resolver every `.ts`
    // import fails to resolve and path-based rules (below) silently no-op —
    // reporting zero violations while enforcing nothing.
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: [`${workspaceRoot}/apps/api/tsconfig.json`],
        },
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'openai', message: 'Control plane must not import vendor AI SDKs.' },
            { name: '@anthropic-ai/sdk', message: 'Control plane must not import vendor AI SDKs.' },
            { name: '@google/genai', message: 'Control plane must not import vendor AI SDKs.' },
          ],
        },
      ],
      // LLD §3.4 — apps/api layer + module boundaries. Domain is pure (no
      // infra/interface/application imports); application must not know about
      // persistence or HTTP; interface must not reach past application;
      // cross-module imports only through a module's index.ts barrel; the
      // generated Prisma client is importable only from common/prisma.
      'import/no-restricted-paths': [
        'error',
        {
          basePath: workspaceRoot,
          zones: [
            // NOTE: every `target`/`from` below must carry a recursive `/**/*`
            // suffix. A bare directory glob (`.../domain`) matches only the
            // literal directory path and never any file inside it, so the zone
            // matches zero files and silently enforces nothing.
            {
              target: './apps/api/src/modules/*/domain/**/*',
              from: './apps/api/src/modules/*/infrastructure/**/*',
            },
            {
              target: './apps/api/src/modules/*/domain/**/*',
              from: './apps/api/src/modules/*/interface/**/*',
            },
            {
              target: './apps/api/src/modules/*/domain/**/*',
              from: './apps/api/src/modules/*/application/**/*',
            },
            {
              target: './apps/api/src/modules/*/application/**/*',
              from: './apps/api/src/modules/*/infrastructure/**/*',
            },
            {
              target: './apps/api/src/modules/*/application/**/*',
              from: './apps/api/src/modules/*/interface/**/*',
            },
            {
              target: './apps/api/src/modules/*/interface/**/*',
              from: './apps/api/src/modules/*/infrastructure/**/*',
            },
            // Cross-module: a module may only be reached through its own
            // index.ts barrel. Expressed per-module because a single
            // modules -> modules zone cannot distinguish a same-module import
            // (always allowed) from a cross-module one.
            ...apiModules.map((moduleName) => ({
              target: `./apps/api/src/modules/!(${moduleName})/**/*`,
              // Every path inside the module *except* its barrel: the layer
              // sub-directories and the NestJS module file itself.
              from: [
                `./apps/api/src/modules/${moduleName}/*/**/*`,
                `./apps/api/src/modules/${moduleName}/*.module.ts`,
              ],
            })),
            // The generated Prisma client is reachable only from
            // common/prisma. Restriction is expressed on `target` (everything
            // under src *except* common/prisma) rather than via `except`,
            // because `except` carves out sub-paths of `from`, not of the
            // target. `from` covers both the workspace symlink and the pnpm
            // `.pnpm` real path the resolver may report.
            {
              target: [
                './apps/api/src/*.ts',
                './apps/api/src/modules/**/*',
                './apps/api/src/common/!(prisma)/**/*',
                './apps/api/src/common/*.ts',
              ],
              from: [
                // The client Prisma actually generates for this project
                // (schema.prisma `output = "../src/generated/prisma"`).
                './apps/api/src/generated/prisma/**/*',
                // Belt-and-braces: the npm package must not be imported either.
                './**/node_modules/@prisma/client/**/*',
                './**/node_modules/.pnpm/**/@prisma/client/**/*',
              ],
            },
            // `livekit-server-sdk` is importable only from
            // `transport/infrastructure` (LLD §3.4 boundary grep #2) — every
            // other use case depends on the `LIVEKIT_CLIENT` port instead.
            {
              target: [
                './apps/api/src/*.ts',
                './apps/api/src/modules/!(transport)/**/*',
                './apps/api/src/modules/transport/!(infrastructure)/**/*',
                // The entry above only reaches files nested at least one
                // directory below `transport/` — it misses flat files that
                // sit directly in `transport/` itself, sibling to
                // `infrastructure/` (`transport.module.ts`, `index.ts`), for
                // the same structural reason as the two `conversation` SPA
                // leaf-file fixes above (QA Phase 3 D-2 full-file audit).
                './apps/api/src/modules/transport/!(infrastructure)*',
                './apps/api/src/common/**/*',
              ],
              from: [
                './**/node_modules/livekit-server-sdk/**/*',
                './**/node_modules/.pnpm/**/livekit-server-sdk/**/*',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    // apps/web — feature isolation (LLD §3.4): a feature may import core/,
    // shared/, and projects/shared, never another feature directly.
    files: ['apps/web/projects/**/*.ts'],
    plugins: { import: importPlugin },
    // Same resolver requirement as apps/api above — without it the zones below
    // cannot resolve `.ts` imports and silently enforce nothing.
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: [`${workspaceRoot}/apps/web/tsconfig.json`],
        },
      },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          basePath: workspaceRoot,
          zones: [
            // One zone per feature: any *other* feature is forbidden from
            // reaching into it. A single features/* -> features/* zone cannot
            // express this (it would also flag a feature's own internal
            // imports), and `except: ['./']` — the previous formulation —
            // excepted the whole `from` path and so enforced nothing.
            //
            // Phase 16: for the six features `agent-builder` now composes as
            // tab content, `target` also excludes `agent-builder` itself
            // (multi-alternative extglob, `!(a|b)`), so every feature but
            // agent-builder stays blocked from reaching in.
            ...webFeatures.map(({ project, feature }) => {
              const composedByBuilder = project === 'admin' && BUILDER_COMPOSED_FEATURES.includes(feature);
              return {
                target: composedByBuilder
                  ? `./apps/web/projects/${project}/src/app/features/!(${feature}|agent-builder)/**/*`
                  : `./apps/web/projects/${project}/src/app/features/!(${feature})/**/*`,
                from: `./apps/web/projects/${project}/src/app/features/${feature}/**/*`,
              };
            }),
            // `livekit-client` is importable only from the conversation SPA's
            // `core/livekit-room.service.ts` (LLD §1.2 "conversation SPA
            // only") — every other file, including this SPA's own features,
            // depends on that service's signals instead of the SDK directly.
            {
              target: [
                './apps/web/projects/admin/**/*',
                './apps/web/projects/shared/**/*',
                './apps/web/projects/conversation/src/app/features/**/*',
                './apps/web/projects/conversation/src/app/!(core)/**/*',
                // The `!(core)/**/*` entry above only reaches files nested at
                // least one directory below `app/` (e.g. `features/**/*`,
                // already covered separately anyway) — it does NOT reach the
                // flat files that live directly in `app/` itself
                // (`app.routes.ts`, `app.config.ts`, `app.component.ts`),
                // for the same structural reason as the `core/` leaf-file fix
                // above (QA Phase 3 D-2 audit: this project has now hit this
                // bug class three times — Phase 1's D-2, Phase 2's zones, and
                // this one — so every zone in this file was re-audited, not
                // just the one QA explicitly reported).
                './apps/web/projects/conversation/src/app/!(core)*',
                // `core/` is flat (no subdirectories), so this must match a
                // *leaf file* directly, not a directory to recurse into — a
                // trailing `/**/*` (the fix applied to the other zones below)
                // would be wrong here: it requires the excluded segment to be
                // followed by further path components, which never happens
                // for a flat file and silently stops matching entirely (QA
                // Phase 3 D-2, verified with `is-glob`/`minimatch` directly:
                // the bare extglob is mis-detected as a *non*-glob string by
                // `is-glob` once `path.resolve` joins it with a preceding
                // OS path-separator backslash on Windows, so the rule falls
                // back to plain path-containment and never matches). The
                // trailing bare `*` is redundant for matching purposes but
                // gives `is-glob` an unambiguous, unescaped glob character to
                // detect regardless of the preceding separator.
                './apps/web/projects/conversation/src/app/core/!(livekit-room.service.ts)*',
              ],
              from: ['./**/node_modules/livekit-client/**/*', './**/node_modules/.pnpm/**/livekit-client/**/*'],
            },
            // core/ must never depend on a lazy feature (LLD §3.4). Same
            // recursive-suffix requirement as the apps/api zones: a bare
            // directory glob matches no files and would no-op silently.
            {
              target: './apps/web/projects/*/src/app/core/**/*',
              from: './apps/web/projects/*/src/app/features/**/*',
            },
          ],
        },
      ],
    },
  },
);
