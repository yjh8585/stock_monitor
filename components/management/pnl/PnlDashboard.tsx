'use client';

import { useMemo } from 'react';
import CompanyOverview from './CompanyOverview';
import DivisionPerformance from './DivisionPerformance';
import CustomerPerformance from './CustomerPerformance';
import ProductPerformance from './ProductPerformance';
import ProductCustomerCross from './ProductCustomerCross';
import SilPerformance from './SilPerformance';
import MarginScatter from './MarginScatter';
import YoyMonthlyCompare from './YoyMonthlyCompare';
import YoyProductCustomer from './YoyProductCustomer';
import Insights from './Insights';
import { deriveStandaloneAnnual } from '@/lib/pnl/aggregate';
import type { Basis, PnlEntry } from '@/lib/pnl/types';

interface Props {
  data: PnlEntry[];
}

/** basis별로 분리된 PnlEntry 묶음 (성능 최적화용 reference) */
export type EntriesByBasis = Record<Basis, PnlEntry[]>;

/**
 * 손익 페이지 클라이언트 루트.
 *
 * - 원본 row를 받아 별도 연간 derive 한 번만 수행 (useMemo로 캐시)
 * - 5개 표 섹션 + 추가 5개 차트 섹션
 * - 월별 차트는 원본 data 사용, 연간 차트는 annualEntries 사용
 *
 * 성능 최적화:
 * - `annualByBasis` / `monthlyByBasis` 를 미리 분리해 자식에 prop 전달
 *   → basis 토글 시 자식이 전체(1k+ 행) 대신 절반 배열만 필터/그룹 수행
 */
export default function PnlDashboard({ data }: Props) {
  const annualEntries = useMemo<PnlEntry[]>(() => {
    // 연결: period_month=0 만 사용 (DB에 이미 연간 합계 있음)
    const consolidatedAnnual = data.filter(
      (e) => e.basis === 'consolidated' && e.period_month === 0
    );
    // 별도: 월별 → 연간 derive
    const standaloneMonthly = data.filter(
      (e) => e.basis === 'standalone' && e.period_month >= 1 && e.period_month <= 12
    );
    const standaloneAnnual = deriveStandaloneAnnual(standaloneMonthly);
    return [...consolidatedAnnual, ...standaloneAnnual];
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
      <CompanyOverview annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <DivisionPerformance annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <CustomerPerformance annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <ProductPerformance annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <ProductCustomerCross annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <SilPerformance annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <MarginScatter annualEntries={annualEntries} annualByBasis={annualByBasis} />
      <YoyMonthlyCompare data={data} monthlyByBasis={monthlyByBasis} />
      <YoyProductCustomer
        data={data}
        annualEntries={annualEntries}
        annualByBasis={annualByBasis}
        monthlyByBasis={monthlyByBasis}
      />
      <Insights annualEntries={annualEntries} annualByBasis={annualByBasis} />
    </div>
  );
}
