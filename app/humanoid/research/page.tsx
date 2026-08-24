import { ResearchList } from '@/components/humanoid/research-list';
import { getResearchData } from '@/lib/humanoid/research';

/**
 * 휴머노이드 > 증권사 리포트 (server) — 네이버 증권 리서치 수집분.
 *
 * fetch + cache + 묶음 구성은 lib/humanoid/research.ts 에 격리하고 여기서는 부르기만 한다
 * (/humanoid 기업 페이지와 같은 패턴). searchParams 를 쓰지 않으므로 Suspense 도 없다.
 */
export default async function HumanoidResearchPage() {
  const { groups, brokers, total, summarized } = await getResearchData();

  return (
    <div className="flex h-full flex-col">
      <ResearchList groups={groups} brokers={brokers} total={total} summarized={summarized} />
    </div>
  );
}
