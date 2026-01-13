/* eslint-env node */

module.exports = {
  root: true,
  env: { 
    browser: true, 
    es2020: true,
    node: true 
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    /**
     * This is the fix for the Parsing Error.
     * We point to BOTH the app and node configs. 
     * This allows ESLint to understand 'src/' files AND 'vite.config.ts'.
     */
    project: ['./tsconfig.app.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Relaxed rules for development flexibility
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
  /**
   * We ignore the validators and lib folders because 
   * they contain Aiken code or raw Plutus scripts 
   * that shouldn't be linted by TypeScript/ESLint.
   */
  ignorePatterns: [
    'dist', 
    '.eslintrc.cjs', 
    'node_modules', 
    'validators', 
    'lib', 
    'plutus.json'
  ],
}