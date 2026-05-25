module.exports = {
  extension: ['ts'],
  require: ['tsx/cjs', 'tests/e2e/support/test-hooks.ts'],
  spec: ['tests/e2e/**/*.spec.ts'],
  timeout: 30_000,
  reporter: 'spec',
};
