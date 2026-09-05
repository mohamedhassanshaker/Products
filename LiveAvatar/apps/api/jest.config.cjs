/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/main-internal.ts',
    '!src/generated/**',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: './coverage',
  coverageThreshold: {
    global: { lines: 80, branches: 80 },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@liveavatar/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
