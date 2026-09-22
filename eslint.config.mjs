import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        // prototype and apps/frontend are Vite/React apps expected to carry
        // their own toolchain and their own tsconfig with DOM/JSX support
        // once they exist — this config has no react plugin or browser
        // globals configured, so it would flag spurious errors on their
        // files. Linted independently, not by this root config.
        ignores: [
            '**/dist/**',
            '**/build/**',
            '**/coverage/**',
            '**/node_modules/**',
            '**/.venv/**',
            '**/__pycache__/**',
            'prototype/**',
            'apps/frontend/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            globals: { ...globals.node },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            'no-console': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/explicit-function-return-type': [
                'warn',
                { allowExpressions: true },
            ],
        },
    },
    {
        // Composition roots log to the console before a logger exists.
        files: ['**/server.ts', '**/main.ts'],
        rules: { 'no-console': 'off' },
    },
    {
        // Test files: the node:test `test()` helper returns a fire-and-forget
        // promise by design, and console output is expected.
        files: ['**/*.test.ts', '**/tests/**/*.ts'],
        rules: {
            '@typescript-eslint/no-floating-promises': 'off',
            'no-console': 'off',
        },
    },
    {
        // CLI scripts (migrations, seeding, ...) report progress to the console
        // by design — there's no logger, and no request to attach one to.
        files: ['**/scripts/**/*.ts'],
        rules: { 'no-console': 'off' },
    },
    {
        // Config and scripts are plain JS / not part of the type-checked project.
        files: ['**/*.mjs', '**/*.config.{js,mjs,ts}'],
        extends: [tseslint.configs.disableTypeChecked],
        rules: {
            'no-console': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
        },
    },
    prettier,
);
