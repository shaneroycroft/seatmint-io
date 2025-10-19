import js from '@eslint/js';
import globals from 'globals';
import standard from 'eslint-config-standard';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import nPlugin from 'eslint-plugin-n';
import promisePlugin from 'eslint-plugin-promise';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      import: importPlugin,
      n: nPlugin,
      promise: promisePlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...standard.rules,
      ...prettier.rules,
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
    },
  },
];