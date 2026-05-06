import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Python 가상환경 및 외부 스크립트
    'scripts/venv/**',
    'scripts/analyze_fnguide*.py',
    // 외부 서브모듈 (mcp-shrimp-task-manager)
    'mcp-shrimp-task-manager/**',
  ]),
]);

export default eslintConfig;
