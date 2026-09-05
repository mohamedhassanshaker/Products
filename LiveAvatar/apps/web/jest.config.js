/** Jest configuration for both Angular SPAs and the shared library (LLD §1.2). */
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  roots: ['<rootDir>/projects'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^@liveavatar/web-shared$': '<rootDir>/projects/shared/src/public-api.ts',
    '^@liveavatar/web-shared/(.*)$': '<rootDir>/projects/shared/src/lib/$1',
    // Resolve straight to source so tests don't require a prior `contracts` build step.
    '^@liveavatar/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  collectCoverageFrom: [
    'projects/**/src/**/*.ts',
    '!projects/**/src/**/*.spec.ts',
    '!projects/**/src/main.ts',
    '!projects/**/src/**/*.module.ts',
    // Bootstrap wiring only (providers/route-table declarations, no branching
    // logic) — same exclusion rationale as apps/api's main.ts/*.module.ts.
    '!projects/**/src/app/app.config.ts',
    '!projects/**/src/app/**/*.routes.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 80,
    },
  },
};
