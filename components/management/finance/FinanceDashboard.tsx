'use client';

import dynamic from 'next/dynamic';
import LazyMount from '@/components/common/LazyMount';
import type { FinanceRow } from '@/lib/finance/types';

const FinanceLeverageChart = dynamic(() => import('./FinanceLeverageChart'), { ssr: false });
const FinanceCapitalTable = dynamic(() => import('./FinanceCapitalTable'), { ssr: false });

interface Props {
  rows: FinanceRow[];
}

/** 재무 탭 대시보드 — 콤보 차트 + 투하자본/자금조달 표. 차트는 lazy 코드 스플릿. */
export default function FinanceDashboard({ rows }: Props) {
  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <FinanceLeverageChart rows={rows} />
      </LazyMount>

      <LazyMount className="min-h-[300px]">
        <FinanceCapitalTable rows={rows} />
      </LazyMount>
    </div>
  );
}
