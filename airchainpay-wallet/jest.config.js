/**
 * Jest configuration for pure-logic unit tests (e.g. the cryptographic core in
 * src/utils/crypto/WalletCrypto.ts).
 *
 * These tests run in a plain Node environment. We deliberately transpile with a
 * self-contained Babel config (`configFile: false` / `babelrc: false`) so the
 * app's `babel-preset-expo` / metro-specific config is NOT applied here. The
 * @noble/* and crypto-js packages ship CommonJS builds, so nothing inside
 * node_modules needs transformation.
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        configFile: false,
        babelrc: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};
