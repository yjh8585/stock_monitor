'use client';

import dynamic from 'next/dynamic';
import { ChartSection } from '@/components/management/plan/_selectors';
import { UNIT_REVENUE_CV_WARN } from '@/lib/stellantis-forecast/aggregate';
import type { UnitRevenueSeries } from '@/lib/stellantis-forecast/types';
import { ChartFallback } from './ChartFallback';
import { fmtRatioPct } from './format';

const Inner = dynamic(() => import('./StellantisUnitRevenueChartInner'), {
  ssr: false,
  loading: () => <ChartFallback size="md" />,
});

/**
 * 차트 3 — 대당 매출 원단위 안정성.
 *
 * 4번 전망은 `출하 전망 × 원단위`라 **원단위가 흔들리면 전망도 함께 흔들린다.**
 * 이 차트는 그 전제가 성립하는지를 눈으로 확인하라고 있는 것이다 — 그래서 제목·부제에
 * "전망의 전제"임을 명시하고, 변동계수(CV)가 임계치를 넘으면 경고를 띄운다.
 */
export default function StellantisUnitRevenueChart({ series }: { series: UnitRevenueSeries }) {
  const unstable = series.cv > UNIT_REVENUE_CV_WARN;
  return (
    <ChartSection title="3. 대당 매출 원단위 — 4번 전망의 전제" unit="원/대">
      <p className="mb-2 text-sm text-muted-foreground">
        자사 매출(억원) ÷ 북미 출하(대). 소매가 아니라 출하로 나누는 이유는 부품 매출이 딜러 재고를
        거치지 않고 <b>OEM의 생산·출하에 연동</b>되기 때문입니다. 이 선이 평평할수록 4번 전망(출하 ×
        원단위)이 유효합니다.
      </p>
      <p
        className={`mb-2 text-sm ${unstable ? 'font-medium text-amber-600' : 'text-muted-foreground'}`}
      >
        변동계수(CV) {fmtRatioPct(series.cv)} — 평균 대비 편차 비율.{' '}
        {unstable
          ? `임계치 ${fmtRatioPct(UNIT_REVENUE_CV_WARN, 0)}를 넘어 원단위가 불안정합니다. 4번 전망은 참고용으로만 보십시오.`
          : `임계치 ${fmtRatioPct(UNIT_REVENUE_CV_WARN, 0)} 이내로 안정적입니다.`}
      </p>
      <Inner series={series} />
    </ChartSection>
  );
}
