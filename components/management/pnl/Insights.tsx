'use client';

import WaterfallProfitability from './WaterfallProfitability';
import CustomerParetoChart from './CustomerParetoChart';
import type { PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/**
 * 13. 시사점 컨테이너 — 수익성 워터폴 + 고객 파레토 2개 차트.
 * (부문별 효율 매트릭스는 8번 버블 차트와 중복되어 제거)
 */
export default function Insights({ annualEntries, annualByBasis }: Props) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3">
        <h2 className="text-lg font-semibold">13. 시사점</h2>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WaterfallProfitability annualEntries={annualEntries} annualByBasis={annualByBasis} />
        <CustomerParetoChart annualEntries={annualEntries} annualByBasis={annualByBasis} />
      </div>
    </section>
  );
}
