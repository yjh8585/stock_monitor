import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@supabase/ssr',
    '@napi-rs/canvas',
    'pdfjs-dist',
    'jsdom',
    '@mozilla/readability',
    'youtube-transcript',
  ],
  // Next.js 16 Cache Components (PPR 기반). 페이지·함수에 'use cache' 디렉티브로 캐싱.
  // 데이터 fetch 페이지(/related-stocks, /domestic, /oem, /parts-top100)에서 사용 중.
  cacheComponents: true,
  experimental: {
    // 라우터 캐시 TTL을 0으로 설정 → 페이지 재방문 시 클라이언트 컴포넌트가 초기 상태로 재마운트됨.
    // 서버 데이터는 'use cache' 디렉티브가 캐싱하므로 실제 DB 재조회는 없음.
    staleTimes: {
      dynamic: 0,
      static: 30,
    },
  },
};

export default nextConfig;
