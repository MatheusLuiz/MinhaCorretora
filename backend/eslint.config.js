// ESLint (flat config). Regras recomendadas do TypeScript, sem checagem de
// tipos (o `tsc` já faz isso — aqui é o que o compilador não pega).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'armazenamento/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // `_` na frente = descartado de propósito (desestruturação, parâmetro).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Linhas cruas do mysql2 e scripts de diagnóstico usam `any`: aviso, não erro.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
