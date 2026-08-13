import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // Next.js는 웹팩 리졸버에서 서버 번들 빌드 시 'server-only'를 no-op으로 치환한다
      // (클라이언트 번들에선 throw하는 마커로 치환해 오사용을 잡는다). Vite/Vitest 리졸버는
      // 이 특수 처리를 모르고 npm 'server-only' 패키지의 기본 진입점(무조건 throw)을 그대로
      // 로드하므로, source.ts를 직접 import하는 테스트가 즉시 에러로 죽는다. Next가 서버 빌드에
      // 쓰는 것과 동일한 no-op(next/dist/compiled/server-only/empty.js)으로 별칭 처리해 우회.
      'server-only': 'next/dist/compiled/server-only/empty.js',
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'lib/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts', 'lib/**/__tests__/**', 'lib/database.types.ts'],
    },
  },
});
