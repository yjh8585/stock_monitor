'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import CostStructure from './CostStructure';
import CompanyOverview from './CompanyOverview';
import DivisionPerformance from './DivisionPerformance';
import CustomerPerformance from './CustomerPerformance';
import ProductPerformance from './ProductPerformance';
import ProductCustomerCross from './ProductCustomerCross';
import SilPerformance from './SilPerformance';
import Forecast2026 from './Forecast2026';
import LazyMount from '@/components/common/LazyMount';
import { preparePnlData } from '@/lib/pnl/aggregate';
import type { Basis, CostStructureRow, PnlEntry } from '@/lib/pnl/types';

// 무거운 차트 컴포넌트 — recharts 청크를 차트 단위로 lazy 분리.
// 각 차트는 LazyMount 안에 들어가 viewport 진입 시 청크 download + mount.
const MarginScatter = dynamic(() => import('./MarginScatter'), { ssr: false });
const YoyMonthlyCompare = dynamic(() => import('./YoyMonthlyCompare'), { ssr: false });
const YoyMonthlyFiltered = dynamic(() => import('./YoyMonthlyFiltered'), { ssr: false });
const YoyProductCustomer = dynamic(() => import('./YoyProductCustomer'), { ssr: false });
const Insights = dynamic(() => import('./Insights'), { ssr: false });

interface Props {
  data: PnlEntry[];
  costStructure: CostStructureRow[];
}

/** basis별로 분리된 PnlEntry 묶음 (성능 최적화용 reference) */
export type EntriesByBasis = Record<Basis, PnlEntry[]>;

/**
 * 손익 페이지 클라이언트 루트.
 *
 * - 원본 row를 받아 별도 연간 derive 한 번만 수행 (useMemo로 캐시)
 * - 1~5번 표 섹션 + 6~10번 차트/표 섹션 (총 10개)
 * - 월별 차트는 원본 data 사용, 연간 차트는 annualEntries 사용
 *
 * 성능 최적화:
 * - `annualByBasis` / `monthlyByBasis` 를 미리 분리해 자식에 prop 전달
 *   → basis 토글 시 자식이 전체(1k+ 행) 대신 절반 배열만 필터/그룹 수행
 * - 차트가 들어간 하단 섹션(MarginScatter / YoyMonthlyCompare /
 *   YoyProductCustomer / Insights)은 `LazyMount`로 감싸 viewport 진입 시
 *   1회 마운트. 초기 렌더에서 Recharts ResizeObserver/parse 비용을 절약.
 */
export default function PnlDashboard({ data, costStructure }: Props) {
  // 원본 data → derived 변환 (연결 연간 + 2026 YTD derive + 별도 연간 derive + basis별 분리)을
  // 한 번에 수행. 정책 상세는 preparePnlData의 JSDoc 참고.
  const { annualEntries, annualByBasis, monthlyByBasis } = useMemo(
    () => preparePnlData(data),
    [data]
  );

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
      <LazyMount className="min-h-[420px] md:min-h-[540px]">
        <YoyMonthlyCompare data={data} monthlyByBasis={monthlyByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[420px] md:min-h-[540px]">
        <YoyMonthlyFiltered monthlyByBasis={monthlyByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[440px] md:min-h-[560px]">
        <YoyProductCustomer
          data={data}
          annualEntries={annualEntries}
          annualByBasis={annualByBasis}
          monthlyByBasis={monthlyByBasis}
        />
      </LazyMount>
      {/* Insights: 2개 차트 (워터폴 + 파레토). 모바일은 세로 stack. */}
      <LazyMount className="min-h-[820px] lg:min-h-[460px]">
        <Insights annualEntries={annualEntries} annualByBasis={annualByBasis} />
      </LazyMount>
    </div>
  );
}
