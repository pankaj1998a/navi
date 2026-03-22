import js from '@eslint/js'
import globals from 'globals'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
    {
        ignores: [
            'node_modules/',
            'dist/',
            'build/',
            '*.d.ts',
            'generated/',
            '__mocks__/',
            'test/',
            'test-utils/',
        ],
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parser: tsParser,
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
                ...globals.es2022,
                Bun: 'readonly',
                NodeJS: 'readonly',
                window: 'readonly',
                HTMLRewriter: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...tseslint.configs.recommended.rules,
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-namespace': 'warn',
            '@typescript-eslint/no-require-imports': 'warn',
            '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-ignore': 'allow-with-description' }],
            'no-case-declarations': 'warn',
            'no-undef': 'warn',
            'no-unsafe-finally': 'warn',
            'no-useless-escape': 'warn',
            'no-empty': 'warn',
            'no-constant-condition': 'warn',
            'no-redeclare': 'warn',
        },
    },
]
