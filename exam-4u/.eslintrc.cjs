/**
 * Root ESLint config. Implements LLD §1.4's import-boundary table as CI-failing lint rules (not
 * just code-review convention). Each `no-restricted-imports` override below corresponds to one or
 * more rows of that table; see the inline comments.
 *
 * Important structural note: ESLint 8's legacy (`.eslintrc.cjs`) `overrides` cascade *per rule
 * name*, not per rule option — the most-specific matching override for a given file completely
 * replaces any less-specific override's options for the same rule, they do not merge. Because
 * every boundary in LLD §1.4 is expressed through the same `no-restricted-imports` rule, each
 * override below re-states the *full* set of restrictions that should apply at that directory
 * depth (e.g. the `modules/**` override repeats the third-party-SDK restriction from the base
 * override, then adds its own), rather than only the incremental addition. This is verbose but
 * necessary for correctness; a `dependency-cruiser` config would compose more cleanly if this list
 * grows much further in a later phase.
 *
 * `packages/contracts`'s "no runtime dependencies" rule (LLD §1.4's last row) is enforced
 * structurally instead of via a lint rule: its `package.json` declares an empty `dependencies`
 * object, so any accidental non-type-only third-party import fails module resolution at build time
 * — a stronger guarantee than a lint pattern, and simpler than wiring dependency-cruiser for a
 * single-package rule. Documented here as a deliberate Dev-0a judgment call rather than silently
 * dropping that row of the table.
 */

/** Third-party SDKs confined to apps/api/src/infrastructure/** (LLD §1.4 row 2). `@google/adk` is
 * now (Dev-14/BL-12a, LLD §14.1 item 2, amended 2026-08-08) a FLAT repo-wide ban — the TypeScript
 * ADK, `AiStepPort`, and `PlainAiStep` no longer exist anywhere in this repo (HLD §8.0): the ADK
 * lives exclusively in `services/ai-engine` (Python), which this ESLint config does not cover. */
const THIRD_PARTY_SDK_PATHS = [
  { name: 'stripe', message: 'stripe is importable only from infrastructure/** (LLD §1.4).' },
  {
    name: '@qdrant/js-client-rest',
    message:
      '@qdrant/js-client-rest is confined to infrastructure/vector/qdrant.adapter.ts only ' +
      '(HLD §6.2 single chokepoint) — see the base and infrastructure/** overrides below.',
  },
  { name: 'nodemailer', message: 'nodemailer is importable only from infrastructure/** (LLD §1.4).' },
  { name: 'mysql2', message: 'mysql2 is importable only from infrastructure/** (LLD §1.4).' },
  {
    name: 'google-auth-library',
    message: 'google-auth-library is importable only from infrastructure/** (LLD §1.4).',
  },
  { name: 'pdfjs-dist', message: 'pdfjs-dist is importable only from infrastructure/** (LLD §1.4).' },
  { name: 'yauzl', message: 'yauzl is importable only from infrastructure/** (LLD §1.4).' },
  { name: 'bcrypt', message: 'bcrypt is importable only from infrastructure/** (LLD §1.4).' },
];

/** Amended 2026-08-08 (final, LLD §14.1 item 2): `@google/adk` is banned everywhere in
 * `apps/api/src/**`, with NO exemption directory (unlike the SDKs above, which are merely confined
 * to `infrastructure/**`). Kept as its own `no-restricted-imports` entry, applied at the top level
 * only, so no override below can accidentally re-permit it the way `infrastructure/**`'s override
 * re-permits the other confined SDKs. */
const GOOGLE_ADK_FLAT_BAN = {
  name: '@google/adk',
  message:
    '@google/adk must not be imported anywhere in apps/api — the ADK lives exclusively in ' +
    'services/ai-engine (Python), reached only via AiServicePort/AiServiceClient (LLD §14.1 item 2, HLD §8.0).',
};

/** Added 2026-08-08 (Dev-14/BL-12a, LLD §9.9/§14.1 item 2): `rejectUnauthorized: false` must never
 * appear anywhere in apps/api — hostname/chain verification on the AiServiceClient's https.Agent
 * (and any other TLS client this codebase ever grows) is always on, with no configurable escape
 * hatch. Expressed as a `no-restricted-syntax` selector (an object-property AST match), not a
 * string-literal grep, so it fires regardless of surrounding formatting/quoting. */
const NO_REJECT_UNAUTHORIZED_FALSE = {
  selector: "Property[key.name='rejectUnauthorized'][value.value=false]",
  message:
    'rejectUnauthorized: false is banned repo-wide (LLD §9.9) — TLS hostname/chain verification must always be on.',
};

/** modules/** may not reach into another bounded context's platform infrastructure (LLD §1.4 row 3). */
const NO_PLATFORM_INFRA_PATTERN = {
  group: ['**/platform/**/infrastructure/**', '**/platform-data-source*'],
  message: 'modules/** may not import platform/**/infrastructure/** or PlatformDataSource (LLD §1.4).',
};

/** A module's api/** (HTTP edge) may not import that module's own entities (LLD §1.4 row 4). */
const NO_ENTITIES_PATTERN = {
  group: ['**/infrastructure/entities/**'],
  message: 'api/** (HTTP edge) may not import infrastructure/entities/** (LLD §1.4).',
};

/** domain/** must stay framework-free (LLD §1.4 row 5). */
const NO_NESTJS_PATTERN = {
  group: ['@nestjs/*'],
  message: 'domain/** must be framework-free — no @nestjs/* imports, not even @nestjs/common (LLD §1.4).',
};

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true, jest: true },
  ignorePatterns: [
    'dist/',
    'coverage/',
    'node_modules/',
    '**/*.spec.ts',
    '**/*.e2e-spec.ts',
    '**/*.integration-spec.ts',
  ],
  rules: {
    'no-console': ['error', { allow: ['error'] }],
    // Flat, repo-wide, no exemption directory (unlike the confined-to-infrastructure/** SDKs
    // below) — see GOOGLE_ADK_FLAT_BAN's own comment.
    'no-restricted-imports': ['error', { paths: [GOOGLE_ADK_FLAT_BAN] }],
    'no-restricted-syntax': ['error', NO_REJECT_UNAUTHORIZED_FALSE],
  },
  overrides: [
    // ── Base: every file under apps/api/src, except infrastructure/**, may not import any of the
    //    confined third-party SDKs (LLD §1.4 rows 1-2), IN ADDITION to the top-level @google/adk
    //    flat ban and rejectUnauthorized:false ban above (overrides replace same-named rule
    //    options per file, see this file's header note — so GOOGLE_ADK_FLAT_BAN is re-stated in
    //    every override below that sets `no-restricted-imports`, and `no-restricted-syntax` is
    //    deliberately left alone by every override so the top-level rule is never replaced). ──
    {
      files: ['apps/api/src/**/*.ts'],
      excludedFiles: ['apps/api/src/infrastructure/**/*.ts'],
      rules: { 'no-restricted-imports': ['error', { paths: [...THIRD_PARTY_SDK_PATHS, GOOGLE_ADK_FLAT_BAN] }] },
    },
    // ── infrastructure/** itself may use every confined SDK except @qdrant/js-client-rest
    //    (confined further, to exactly infrastructure/vector/qdrant.adapter.ts, HLD §6.2's single
    //    chokepoint — Dev-13/VEC-BOOT). @google/adk remains banned here too (flat ban, no
    //    exemption — LLD §14.1 item 2). ──
    {
      files: ['apps/api/src/infrastructure/**/*.ts'],
      excludedFiles: ['apps/api/src/infrastructure/vector/qdrant.adapter.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: [GOOGLE_ADK_FLAT_BAN, ...THIRD_PARTY_SDK_PATHS.filter((p) => p.name === '@qdrant/js-client-rest')] },
        ],
      },
    },
    // ── the one file allowed to import @qdrant/js-client-rest: still may not import @google/adk. ──
    {
      files: ['apps/api/src/infrastructure/vector/qdrant.adapter.ts'],
      rules: {
        'no-restricted-imports': ['error', { paths: [GOOGLE_ADK_FLAT_BAN] }],
      },
    },
    // ── modules/**: third-party restriction still applies (re-stated, see file header note) plus
    //    the platform-infrastructure boundary (LLD §1.4 row 3). ──
    {
      files: ['apps/api/src/modules/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: [...THIRD_PARTY_SDK_PATHS, GOOGLE_ADK_FLAT_BAN], patterns: [NO_PLATFORM_INFRA_PATTERN] },
        ],
      },
    },
    // ── a module's api/** (HTTP edge): third-party + platform-infra + no entities (LLD row 4). ──
    {
      files: ['apps/api/src/modules/**/api/**/*.ts', 'apps/api/src/platform/**/api/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [...THIRD_PARTY_SDK_PATHS, GOOGLE_ADK_FLAT_BAN],
            patterns: [NO_PLATFORM_INFRA_PATTERN, NO_ENTITIES_PATTERN],
          },
        ],
      },
    },
    // ── a module's domain/** must stay framework-free: third-party + platform-infra + no
    //    @nestjs/* at all, not even @nestjs/common (LLD row 5). ──
    {
      files: ['apps/api/src/modules/**/domain/**/*.ts', 'apps/api/src/platform/**/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [...THIRD_PARTY_SDK_PATHS, GOOGLE_ADK_FLAT_BAN],
            patterns: [NO_PLATFORM_INFRA_PATTERN, NO_NESTJS_PATTERN],
          },
        ],
      },
    },
  ],
};
