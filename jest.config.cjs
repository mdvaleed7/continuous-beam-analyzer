/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // The engine modules are pure TS math. A self-contained tsconfig
        // (tsconfig.jest.json) keeps the transform fast and decoupled from the
        // Next.js build settings (incremental / rootDir / noEmit) that
        // otherwise clash with ts-jest. isolatedModules lives in
        // tsconfig.jest.json (ts-jest's own option form is deprecated).
        tsconfig: 'tsconfig.jest.json',
      },
    ],
  },
};
