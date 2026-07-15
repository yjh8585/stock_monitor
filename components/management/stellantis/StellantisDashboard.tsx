'use client';

import LazyMount from '@/components/common/LazyMount';
import type { StellantisForecastData } from '@/lib/stellantis-forecast/types';
import StellantisForecastChart from './StellantisForecastChart';
import StellantisGapChart from './StellantisGapChart';
import StellantisRevenueVsRetailChart from './StellantisRevenueVsRetailChart';
import StellantisUnitRevenueChart from './StellantisUnitRevenueChart';

/**
 * 스텔란티스 탭 차트 4종 컨테이너.
 *
 * 각 차트 래퍼가 자기 recharts Inner를 `dynamic(ssr:false)`로 분리하고, 여기서는 `LazyMount`로
 * viewport 진입 시에만 마운트한다(경영관리 다른 탭과 동일 패턴).
 *
 * 차트 순서 = 읽는 순서다: ① 재고가 쌓이는가(원인) → ② 그게 자사 매출에 언제 오는가(시차) →
 * ③ 대당 단가가 안정적인가(전제) → ④ 그래서 매출이 얼마가 되는가(결론).
 */
export default function StellantisDashboard({ data }: { data: StellantisForecastData }) {
  return (
    <div className="space-y-4">
      <LazyMount className="min-h-[480px] lg:min-h-[620px]">
        <StellantisGapChart points={data.gap} />
      </LazyMount>
      <LazyMount className="min-h-[480px] lg:min-h-[620px]">
        <StellantisRevenueVsRetailChart points={data.revenueVsRetail} lag={data.lag} />
      </LazyMount>
      <LazyMount className="min-h-[420px] lg:min-h-[560px]">
        <StellantisUnitRevenueChart series={data.unitRevenue} />
      </LazyMount>
      <LazyMount className="min-h-[480px] lg:min-h-[620px]">
        <StellantisForecastChart forecast={data.forecast} />
      </LazyMount>
    </div>
  );
}
