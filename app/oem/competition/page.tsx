import CompetitionScoreboard from '@/components/oem/competition/CompetitionScoreboard';
import ModelSection from '@/components/oem/competition/ModelSection';
import { getCompetitionOutlooks } from '@/lib/oem-competition/source';

export const metadata = { title: '차종 경쟁 분석' };

export default async function CompetitionPage() {
  const outlooks = await getCompetitionOutlooks();

  if (outlooks.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        분석 데이터 없음. <code>scripts/collect_oem_model_outlook.py</code> 실행이 필요합니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">핵심 차종 경쟁 분석</h2>
        <p className="text-sm text-muted-foreground mt-1">
          MarkLines 판매 실적 + 지역별 경쟁차종 비교 + Cox 딜러 재고 + NHTSA 리콜·불만 + 웹
          검색(신형 출시·소비자 반응)을 근거로 Claude Sonnet 5 가 종합 · 매월 21일 자동 갱신
        </p>
      </div>

      <CompetitionScoreboard outlooks={outlooks} />

      <div className="space-y-4">
        {outlooks.map((o, i) => (
          <ModelSection key={o.modelKey} outlook={o} index={i} />
        ))}
      </div>
    </div>
  );
}
