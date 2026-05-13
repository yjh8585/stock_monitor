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
};

export default nextConfig;
