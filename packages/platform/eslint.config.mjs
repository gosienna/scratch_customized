import { eslintConfigScratch } from 'eslint-config-scratch'
import { globalIgnores } from 'eslint/config'
import globals from 'globals'

export default eslintConfigScratch.defineConfig(
  eslintConfigScratch.recommended,
  {
    files: ['src/**', 'test/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript signatures already document parameter and return types.
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
    },
  },
  {
    // These tests drive scratch-vm, which has no type definitions.
    files: ['test/vm/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['*'],
    languageOptions: {
      globals: globals.node,
    },
  },
  globalIgnores(['coverage/**', 'dist/**', 'node_modules/**']),
)
