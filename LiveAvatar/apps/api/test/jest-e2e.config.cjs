/** @type {import('jest').Config} */
// Separate config from the unit-test jest.config.cjs (LLD §3.4 / D-1 fix):
// e2e specs spin up a real Postgres via testcontainers and drive the
// full HTTP stack with Supertest, so they need a longer timeout and must
// never run inside the fast unit-test pass (`npm test`). Invoked only via
// `npm run test:e2e`.
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@liveavatar/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // Container start + `prisma db push` + a handful of HTTP round trips
  // comfortably exceed Jest's 5s default.
  testTimeout: 120_000,
};
