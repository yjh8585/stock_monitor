import CompetitionCards from '@/components/oem/CompetitionCards';
import { getCompetitionOutlooks } from '@/lib/oem-competition/source';

export const metadata = { title: '차종 경쟁 분석' };

export default async function CompetitionPage() {
  const outlooks = await getCompetitionOutlooks();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">핵심 차종 경쟁 분석</h2>
        <p className="text-sm text-muted-foreground mt-1">
          MarkLines 판매 실적 + 지역별 경쟁차종 비교 + 웹 검색(신형 출시·소비자 반응) + NHTSA 리콜을
          근거로 Claude Sonnet 5 가 종합 · 매월 21일 자동 갱신
        </p>
      </div>
      <CompetitionCards outlooks={outlooks} />
    </div>
  );
}
