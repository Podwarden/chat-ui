import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'publish/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      // Leading-underscore params/vars are the project-wide convention for
      // "intentionally unused".
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // `let input!: HTMLElement` (definite assignment assertion) is later
    // assigned exactly once, but core `prefer-const` doesn't understand the
    // `!` annotation and can't see that a `const` there would be a type
    // error — a known false positive, not a real never-reassigned binding.
    files: ['tests/component/sidebar.test.tsx'],
    rules: { 'prefer-const': 'off' },
  },
  {
    // examples/basic/tailwind.config.cjs is a genuine CommonJS config file
    // (the README's Tailwind 3.4 section has readers copy it verbatim into
    // their own .cjs config, where `require()` is the only legal form) —
    // not TypeScript source the no-require-imports rule is meant to police.
    files: ['examples/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
