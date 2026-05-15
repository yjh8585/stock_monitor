import HansaeDashboard from '@/components/hansae/HansaeDashboard';
import {
  getHansaeCompanies,
  getIntradayQuotes,
  getRecentBoardPosts,
  getRecentSupplyDemand,
  getSentimentSummary,
} from '@/lib/hansae/data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HansaePage() {
  const companies = await getHansaeCompanies();
  const initial = await Promise.all(
    companies.map(async (c) => ({
      company: c,
      intraday: await getIntradayQuotes(c.id),
      posts: await getRecentBoardPosts(c.id, 15),
      sentiment: await getSentimentSummary(c.id, 7),
      supply: await getRecentSupplyDemand(c.id, 5),
    }))
  );

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
        <HansaeDashboard initial={initial} />
      </div>
    </div>
  );
}
