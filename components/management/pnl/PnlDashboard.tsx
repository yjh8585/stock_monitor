'use client';

import dynamic from 'next/dynamic';
import CostStructure from './CostStructure';
import CompanyOverview from './CompanyOverview';
import DivisionPerformance from './DivisionPerformance';
import CustomerPerformance from './CustomerPerformance';
import ProductPerformance from './ProductPerformance';
import ProductCustomerCross from './ProductCustomerCross';
import SilPerformance from './SilPerformance';
import Forecast2026 from './Forecast2026';
import LazyMount from '@/components/common/LazyMount';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis, CostStructureRow, PnlEntry } from '@/lib/pnl/types';

// 무거운 차트 컴포넌트 — recharts 청크를 차트 단위로 lazy 분리.
// 각 차트는 LazyMount 안에 들어가 viewport 진입 시 청크 download + mount.
const MarginScatter = dynamic(() => import('./MarginScatter'), { ssr: false });
const ProfitContribution = dynamic(() => import('./ProfitContribution'), { ssr: false });
const YoyMonthlyCompare = dynamic(() => import('./YoyMonthlyCompare'), { ssr: false });
const YoyMonthlyFiltered = dynamic(() => import('./YoyMonthlyFiltered'), { ssr: false });
const YoyProductCustomer = dynamic(() => import('./YoyProductCustomer'), { ssr: false });
const WaterfallProfitability = dynamic(() => import('./WaterfallProfitability'), { ssr: false });
const CustomerParetoChart = dynamic(() => import('./CustomerParetoChart'), { ssr: false });

interface Props {
  /** 서버에서 preparePnlData 호출 후 derived만 전달 (raw 1k+ 행 직렬화 회피). */
  prepared: PreparedPnlData;
  costStructure: CostStructureRow[];
}

/** basis별로 분리된 PnlEntry 묶음 (성능 최적화용 reference) */
export type EntriesByBasis = Record<Basis, PnlEntry[]>;

/**
 * 손익 페이지 클라이언트 루트.
 *
 * - 서버에서 사전 가공된 `prepared`를 받아 그대로 자식에 전달 (client useMemo 제거)
 * - 1~5번 표 섹션 + 6~10번 차트/표 섹션 (총 10개)
 * - 월별 차트는 monthlyByBasis 사용, 연간 차트는 annualEntries/annualByBasis 사용
 *
 * 성능 최적화:
 * - 서버에서 derived 변환 완료 → RSC payload는 raw 1k+ 행 대신 작은 prepared만.
 * - `annualByBasis` / `monthlyByBasis` 는 basis별 분리되어 토글 시 자식이
 *   전체 대신 절반 배열만 필터/그룹.
 * - 차트가 들어간 하단 섹션(MarginScatter / ProfitContribution /
 *   YoyMonthlyCompare / YoyMonthlyFiltered / YoyProductCustomer /
 *   WaterfallProfitability / CustomerParetoChart)은 `LazyMount`로 감싸
 *   viewport 진입 시 1회 마운트 + recharts 청크 lazy fetch.
 */
export default function PnlDashboard({ prepared, costStructure }: Props) {
  const { annualEntries, annualByBasis, monthlyByBasis } = prepared;

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-6">
      <CostStructure costStructure={costStructure} />
      <Forecast2026
        monthlyByBasis={monthlyByBasis}
        annualByBasis={annualByBasis}
        costStructure={costStructure}
      />
      <CompanyOverview annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <DivisionPerformance annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <CustomerPerformance annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <ProductPerformance annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <ProductCustomerCross annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <SilPerformance annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <LazyMount className="min-h-[420px] md:min-h-[520px]">
        <MarginScatter
          annualEntries={annualEntries}
          annualByBasis={annualByBasis}
          monthlyByBasis={monthlyByBasis}
        />
      </LazyMount>
      <LazyMount className="min-h-[320px] md:min-h-[400px]">
        <ProfitContribution annualEntries={annualEntries} annualByBasis={annualByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[420px] md:min-h-[540px]">
        <YoyMonthlyCompare monthlyByBasis={monthlyByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[420px] md:min-h-[540px]">
        <YoyMonthlyFiltered monthlyByBasis={monthlyByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[440px] md:min-h-[560px]">
        <YoyProductCustomer
          annualEntries={annualEntries}
          annualByBasis={annualByBasis}
          monthlyByBasis={monthlyByBasis}
        />
      </LazyMount>
      <LazyMount className="min-h-[420px] md:min-h-[520px]">
        <WaterfallProfitability annualEntries={annualEntries} annualByBasis={annualByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[420px] md:min-h-[520px]">
        <CustomerParetoChart annualEntries={annualEntries} annualByBasis={annualByBasis} />
      </LazyMount>
    </div>
  );
}
