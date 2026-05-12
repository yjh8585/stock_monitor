'use client';

import DualStockCard from './DualStockCard';
import type { StockCompany } from '@/lib/types';

interface Props {
  krCompanies: readonly StockCompany[];
  overseasCompanies: readonly StockCompany[];
}

/** 국내·해외 카드 두 개를 세로로 배치. 시계열은 카드 내부에서 fetch. */
export default function StockPricesDashboard({ krCompanies, overseasCompanies }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <DualStockCard title="국내 주식" unit="KRW" source="KRX" companies={krCompanies} />
      <DualStockCard
        title="해외 주식"
        unit="USD"
        source="Yahoo Finance"
        companies={overseasCompanies}
      />
    </div>
  );
}
