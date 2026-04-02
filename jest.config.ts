import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  globals: {
    'ts-jest': {
      tsconfig: './tsconfig.test.json',
    },
  },
  // Remap .js imports to .ts for Jest/CommonJS compatibility.
  // Production code uses Node16 ESM-style .js extensions; Jest needs .ts.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testTimeout: 30000,
  setupFilesAfterEnv: ['./tests/setup.ts'],
  collectCoverage: false,
};

export default config;
