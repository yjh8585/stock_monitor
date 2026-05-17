import { Suspense } from 'react';
import HansaeDashboard from '@/components/hansae/HansaeDashboard';
import {
  getDailyPrices,
  getHansaeCompanies,
  getIntradayQuotes,
  getIntradaySupply,
  getRecentBoardPosts,
  getRecentSupplyDemand,
  getSentimentSummary,
} from '@/lib/hansae/data';

// Next.js 16 cacheComponents 하에서는 page 기본이 dynamic이므로
// `dynamic = 'force-dynamic'` / `revalidate = 0` 옵트인은 불필요(빌드 에러를 유발).
// uncached server fetch는 <Suspense> 경계 안에서 수행해야 prerender가 가능하다.

export default function HansaePage() {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">한세그룹 주식 대시보드</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          한세예스24홀딩스 · 한세실업 · 한세엠케이 · 장중 5분 자동 갱신 · 수급/뉴스/종목토론 감성
          병치
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <Suspense fallback={<HansaeFallback />}>
          <HansaeDataLoader />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Supabase 데이터 fetch 분리 — Cache Components 정책상 uncached server access는
 * Suspense 경계 안에서 수행해야 page prerender가 통과한다.
 */
async function HansaeDataLoader() {
  const companies = await getHansaeCompanies();
  const initial = await Promise.all(
    companies.map(async (c) => ({
      company: c,
      daily: await getDailyPrices(c.id, 5),
      intraday: await getIntradayQuotes(c.id),
      posts: await getRecentBoardPosts(c.id, 5),
      sentiment: await getSentimentSummary(c.id, 7),
      supply: await getRecentSupplyDemand(c.id, 5),
      intradaySupply: await getIntradaySupply(c.id),
    }))
  );
  return <HansaeDashboard initial={initial} />;
}

function HansaeFallback() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-64 bg-muted/20 animate-pulse rounded-xl" />
      ))}
    </div>
  );
}
