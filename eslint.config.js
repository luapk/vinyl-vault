// Lint for correctness, not for style.
//
// The bug that prompted this: `userId` was passed to a hook inside a component
// that has no such variable. Vite bundles an unbound identifier without a
// murmur, unit tests never render that panel, and the only thing that found it
// was a 12-minute browser suite -- by which point it had already cost two full
// runs. no-undef answers that in about a second.
//
// Deliberately narrow: every rule here catches code that is wrong, never code
// that is merely written differently. A formatting rule in a 7000-line file is
// a wall of noise that trains everyone to ignore the output.
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const correctness = {
  'no-undef': 'error',
  // Args are often there for shape (a callback's ignored first parameter), so
  // only unused *variables* are reported. A leading underscore opts out.
  'no-unused-vars': ['error', {
    args: 'none',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',
    ignoreRestSiblings: true,
  }],
  'no-const-assign': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-class-members': 'error',
  'no-duplicate-case': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-self-assign': 'error',
  'no-unreachable': 'error',
  'no-unsafe-negation': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  // Rules of Hooks is the same class of problem: code that looks fine and
  // breaks only at runtime, in a component nobody opened during testing.
  'react-hooks/rules-of-hooks': 'error',
  // Left off on purpose. This codebase has effects that deliberately do not
  // list every dependency (the auth deadlock guard, the badge celebration
  // delay), each with a comment explaining why. Turning it on would bury the
  // rules above.
  'react-hooks/exhaustive-deps': 'off',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'test-results/**', 'playwright-report/**'] },

  // exhaustive-deps is off, so the disable comments written for it now look
  // unused. They are documentation of a deliberate choice and stay put.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },

  // Browser code.
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: correctness,
  },

  // Serverless handlers, scripts and the stress suite all run in node.
  {
    files: ['api/**/*.js', 'scripts/**/*.mjs', 'stress/**/*.mjs', '*.config.{js,mjs}', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // The stress specs are node, but the bodies of page.evaluate() callbacks
      // are shipped to the browser and reference window, location and history.
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: correctness,
  },

  // Tests: vitest globals are imported explicitly, but the browser ones a
  // component test touches are not.
  {
    files: ['**/*.test.js', '**/__tests__/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
