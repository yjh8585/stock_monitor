'use client';

import LazyMount from '@/components/common/LazyMount';
import type { StellantisForecastData } from '@/lib/stellantis-forecast/types';
import StellantisGapChart from './StellantisGapChart';
import StellantisMonthlyFlowChart from './StellantisMonthlyFlowChart';

/**
 * 스텔란티스 탭 차트 2종 컨테이너.
 *
 * 각 차트 래퍼가 자기 recharts Inner를 `dynamic(ssr:false)`로 분리하고, 여기서는 `LazyMount`로
 * viewport 진입 시에만 마운트한다(경영관리 다른 탭과 동일 패턴).
 *
 * 순서(사용자 지시 2026-07-16): ① 분기 출하 갭(정확한 항등식) → ② 월별 생산 갭(즉시 갱신,
 * 대신 근사). 같은 질문에 다른 소스로 답하므로 두 차트는 **같은 시각 문법**(막대색·갭 선·이중축
 * 밴드)을 공유한다.
 */
export default function StellantisDashboard({ data }: { data: StellantisForecastData }) {
  return (
    <div className="space-y-4">
      <LazyMount className="min-h-[480px] lg:min-h-[620px]">
        <StellantisGapChart
          points={data.gap}
          projected={data.gapProjected}
          projectedNote={data.projectedNote}
          partialQuarterNote={data.partialQuarterNote}
        />
      </LazyMount>
      <LazyMount className="min-h-[480px] lg:min-h-[620px]">
        <StellantisMonthlyFlowChart
          points={data.monthlyFlow}
          lastCompleteMonth={data.lastCompleteMonth}
        />
      </LazyMount>
    </div>
  );
}
