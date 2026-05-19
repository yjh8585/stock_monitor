'use client';

import { useMemo } from 'react';
import CostStructure from './CostStructure';
import CompanyOverview from './CompanyOverview';
import DivisionPerformance from './DivisionPerformance';
import CustomerPerformance from './CustomerPerformance';
import ProductPerformance from './ProductPerformance';
import ProductCustomerCross from './ProductCustomerCross';
import SilPerformance from './SilPerformance';
import MarginScatter from './MarginScatter';
import YoyMonthlyCompare from './YoyMonthlyCompare';
import YoyMonthlyFiltered from './YoyMonthlyFiltered';
import Forecast2026 from './Forecast2026';
import YoyProductCustomer from './YoyProductCustomer';
import Insights from './Insights';
import LazyMount from '@/components/common/LazyMount';
import { deriveAnnualFromMonthly, deriveStandaloneAnnual } from '@/lib/pnl/aggregate';
import type { Basis, CostStructureRow, PnlEntry } from '@/lib/pnl/types';

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
  const annualEntries = useMemo<PnlEntry[]>(() => {
    // 연결 연간: period_month=0 행. 단 '2026(P)'(계획값)는 표시에서 제외 — 사용자 요구로
    // 2026 실적은 월별 1~N 누적(YTD)으로 별도 derive.
    const consolidatedAnnual = data.filter(
      (e) => e.basis === 'consolidated' && e.period_month === 0 && e.year_label !== '2026(P)'
    );
    // 연결 2026 YTD: 월별 데이터를 합산해 derive (year_label='2026')
    const consolidated2026Ytd = deriveAnnualFromMonthly(data, 'consolidated', (y) => y === 2026);
    // 별도 연간: 월별 → 연간 derive
    const standaloneMonthly = data.filter(
      (e) => e.basis === 'standalone' && e.period_month >= 1 && e.period_month <= 12
    );
    const standaloneAnnual = deriveStandaloneAnnual(standaloneMonthly);
    return [...consolidatedAnnual, ...consolidated2026Ytd, ...standaloneAnnual];
  }, [data]);

  /** basis별 연간 엔트리 분리 — basis 토글 시 자식이 O(n) 필터링을 절반 크기로 줄인다. */
  const annualByBasis = useMemo<EntriesByBasis>(() => {
    const consolidated: PnlEntry[] = [];
    const standalone: PnlEntry[] = [];
    for (const e of annualEntries) {
      if (e.basis === 'consolidated') consolidated.push(e);
      else standalone.push(e);
    }
    return { consolidated, standalone };
  }, [annualEntries]);

  /** basis별 월별 원본 분리 — YoyMonthlyCompare 등 월별 차트용 */
  const monthlyByBasis = useMemo<EntriesByBasis>(() => {
    const consolidated: PnlEntry[] = [];
    const standalone: PnlEntry[] = [];
    for (const e of data) {
      if (e.basis === 'consolidated') consolidated.push(e);
      else standalone.push(e);
    }
    return { consolidated, standalone };
  }, [data]);

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-6">
      <CostStructure costStructure={costStructure} />
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
      <LazyMount className="min-h-[420px] md:min-h-[520px]">
        <Forecast2026 monthlyByBasis={monthlyByBasis} annualByBasis={annualByBasis} />
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
