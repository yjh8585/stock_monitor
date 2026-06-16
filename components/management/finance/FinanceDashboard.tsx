'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import LazyMount from '@/components/common/LazyMount';
import { ChartSection } from '@/components/management/plan/_selectors';
import { buildLoanAchievement, buildLoanKpis } from '@/lib/finance/loan-aggregate';
import type { FinanceRow, LoanRow, PnlDerivedSeries } from '@/lib/finance/types';
import LoanKpiCards from './LoanKpiCards';

const FinanceLeverageChart = dynamic(() => import('./FinanceLeverageChart'), { ssr: false });
const FinanceInterestRateChart = dynamic(() => import('./FinanceInterestRateChart'), {
  ssr: false,
});
const FinanceCapitalTable = dynamic(() => import('./FinanceCapitalTable'), { ssr: false });
// 대여금 계획대비 차트는 재고 탭의 범용 계획/실적 막대 차트를 재사용.
const InventoryAchievementChart = dynamic(
  () => import('@/components/management/inventory/InventoryAchievementChart'),
  { ssr: false }
);

interface Props {
  rows: FinanceRow[];
  pnlDerived: PnlDerivedSeries;
  loanRows: LoanRow[];
}

/** 재무 탭 대시보드 — 콤보 차트 + 투하자본/자금조달 표 + 대여금(이인텔리전스). 차트는 lazy 코드 스플릿. */
export default function FinanceDashboard({ rows, pnlDerived, loanRows }: Props) {
  const loanKpis = useMemo(() => buildLoanKpis(loanRows), [loanRows]);
  const loanPoints = useMemo(() => buildLoanAchievement(loanRows), [loanRows]);

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <FinanceLeverageChart rows={rows} />
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <FinanceInterestRateChart rows={rows} />
      </LazyMount>

      <LazyMount className="min-h-[300px]">
        <FinanceCapitalTable rows={rows} pnlDerived={pnlDerived} />
      </LazyMount>

      {/* 4. 이인텔리전스 대여금 — KPI + 계획 대비 실적 */}
      <LoanKpiCards kpis={loanKpis} />
      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection title="4. 대여금 계획 대비 실적 (이인텔리전스)" unit="억원">
          <InventoryAchievementChart points={loanPoints} unitLabel="억원" showValueLabels />
        </ChartSection>
      </LazyMount>
    </div>
  );
}
