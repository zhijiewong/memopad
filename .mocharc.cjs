module.exports = {
  extension: ['ts'],
  loader: 'tsx',
  require: ['tests/e2e/support/test-hooks.ts'],
  spec: ['tests/e2e/**/*.spec.ts'],
  timeout: 30_000,
  reporter: 'spec',
};
