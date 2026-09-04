import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `fixtures/**` is *input*, not source: the L5 sample apps (E11-S04-T01) are written the way a
  // user's repository would be — plain Node, no repo tooling — and linting them to this project's
  // standards would be linting the test data.
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
