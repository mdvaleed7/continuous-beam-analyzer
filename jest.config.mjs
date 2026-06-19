import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in the test environment
  dir: './',
})

// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const config = {
  // Add more setup options before each test is run
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  // Allow jest to resolve .ts files. next/jest uses Babel by default, which
  // doesn't transpile TypeScript — so we add the ts-jest transform for
  // .ts/.tsx files only. We also override the Babel transform for .js/.jsx
  // so that .js test files importing .ts source files work correctly.
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // When a .js test imports from '../components/wallEngine' (extensionless),
  // jest needs to try .ts before .js. The moduleFileExtensions order above
  // handles that for extensionless imports. For imports that explicitly use
  // '.js' extension (which is valid in ESM but wrong here), strip the
  // extension so the resolver tries .ts/.tsx/.js in order.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
