import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';

const eslintConfig = defineConfig([
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),

  js.configs.recommended,
  ...nextVitals,
  ...nextTs,

  // ===========================================================================
  // Correctness: type-aware linting for the app sources.
  // ===========================================================================
  {
    name: 'bench/typescript',
    files: ['**/*.{ts,tsx,mts}'],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Correctness -------------------------------------------------------
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-unused-private-class-members': 'error',
      'no-loop-func': 'error',
      'no-multi-str': 'error',
      'no-template-curly-in-string': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['arrowFunctions', 'functions', 'methods'] },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // --- Imports -----------------------------------------------------------
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'import/no-duplicates': 'error',

      // --- Relaxations: deliberate patterns in this codebase ----------------
      // Explicit primitive annotations on fields document the data layout.
      '@typescript-eslint/no-inferrable-types': 'off',
      // Indexed loops are intentional in the hot paths.
      '@typescript-eslint/prefer-for-of': 'off',
      // `type` vs `interface` is used interchangeably here.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-generic-constructors': 'off',
      // Bitflag enums (LabelChangeType) need computed members.
      '@typescript-eslint/prefer-literal-enum-member': [
        'error',
        { allowBitwiseExpressions: true },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],

      // --- Warn, don't block: defensive/perf code trips these legitimately ---
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unnecessary-condition': [
        'warn',
        { allowConstantLoopConditions: true },
      ],
    },
  },

  // ===========================================================================
  // Style: formatting is a warning, auto-fixed on save. Never blocks a build.
  // ===========================================================================
  stylistic.configs.customize({
    braceStyle: '1tbs',
    indent: 2,
    quoteProps: 'as-needed',
    semi: true,
    severity: 'warn',
  }),
  {
    name: 'bench/codestyle',
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts}'],
    rules: {
      // Single quotes unless the string itself contains one.
      '@stylistic/quotes': ['warn', 'single', { avoidEscape: true }],
      // JSX attributes keep double quotes, per React convention.
      '@stylistic/jsx-quotes': ['warn', 'prefer-double'],
    },
  },

  // ===========================================================================
  // JSDoc: validate the comments that exist, never demand new ones.
  // ===========================================================================
  {
    name: 'bench/jsdoc',
    files: ['**/*.{ts,tsx,mts}'],
    extends: [jsdoc.configs['flat/recommended-typescript']],
    rules: {
      // Types live in the signature, not the comment.
      'jsdoc/no-defaults': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-property-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/tag-lines': 'off',
    },
  },

  // ===========================================================================
  // Untyped third-party surfaces. `troika-three-text` and
  // `@mapbox/mapbox-gl-rtl-text` ship no types, and the Next webpack config
  // callback is loosely typed, so `any` flows in by design.
  // ===========================================================================
  {
    name: 'bench/untyped-deps',
    files: [
      'app/TextRenderers/Troika.tsx',
      'app/Core/Shaping/RTL.ts',
      'next.config.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // ===========================================================================
  // Plain JS tooling files are outside the TS program.
  // ===========================================================================
  {
    name: 'bench/tooling',
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
    },
  },
]);

export default eslintConfig;
