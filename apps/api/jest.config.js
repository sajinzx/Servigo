/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testTimeout: 30000,
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: { rootDir: '.', strict: true, esModuleInterop: true, target: 'ES2022', module: 'commonjs', skipLibCheck: true } }] },
};
