const baseConfig = require('../../../test/jest-e2e.json');

module.exports = {
  ...baseConfig,
  rootDir: '..',
  // Override roots to only run this service's tests
  roots: ['<rootDir>/test/'],
  // Service-specific tsconfig
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  // Adjust path alias for service location
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@app/common(|/.*)$': '<rootDir>/../../libs/common/src/$1',
  },
};
