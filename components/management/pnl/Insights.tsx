'use client';

import WaterfallProfitability from './WaterfallProfitability';
import CustomerParetoChart from './CustomerParetoChart';
import DivisionEfficiencyBubble from './DivisionEfficiencyBubble';
import type { PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/**
 * 10. 시사점 컨테이너.
 *
 * 3개 차트 grid 배치 (lg:grid-cols-2, 마지막 차트는 전체 행).
 * 각 차트는 자체 basis 토글 + 연도 선택을 가진다.
 */
export default function Insights({ annualEntries, annualByBasis }: Props) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3">
        <h2 className="text-base font-semibold">10. 시사점</h2>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WaterfallProfitability annualEntries={annualEntries} annualByBasis={annualByBasis} />
        <CustomerParetoChart annualEntries={annualEntries} annualByBasis={annualByBasis} />
        <div className="lg:col-span-2">
          <DivisionEfficiencyBubble annualEntries={annualEntries} annualByBasis={annualByBasis} />
        </div>
      </div>
    </section>
  );
}
