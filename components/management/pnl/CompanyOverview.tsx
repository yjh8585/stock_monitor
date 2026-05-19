'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import PnlTable, { type PnlTableRow } from './PnlTable';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  /** 연결 연간 + 별도 연간(derive 후) 행을 모두 포함 */
  annualEntries: PnlEntry[];
  /** basis별로 분리된 reference — 토글 반응성 개선용 */
  annualByBasis: EntriesByBasis;
}

/**
 * 2. 전사 실적 — 연도 × 지표 표.
 *
 * - 연결/별도 토글
 * - 각 연도 1행 + 매출/재료비/노무비/경비/판관비/연구비/영업이익 컬럼
 *
 * 성능: basis 토글 시 `annualByBasis[basis]` 작은 배열만 사용.
 */
export default function CompanyOverview({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');

  /** 현재 basis의 작은 reference 배열 */
  const basisEntries = annualByBasis[basis];

  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );

  const rows: PnlTableRow[] = useMemo(() => {
    return yearLabels.map((lbl) => {
      const yearEntries = entriesForYear(basisEntries, basis, lbl);
      const agg = aggregateBy(yearEntries, []);
      const row = agg[0];
      if (!row) {
        return {
          key: lbl,
          labels: [lbl],
          revenue: 0,
          material_cost: 0,
          labor_cost: 0,
          expense: 0,
          sga: 0,
          rnd: 0,
          op_income: 0,
        };
      }
      return {
        key: lbl,
        labels: [lbl],
        revenue: row.revenue,
        material_cost: row.material_cost,
        labor_cost: row.labor_cost,
        expense: row.expense,
        sga: row.sga,
        rnd: row.rnd,
        op_income: row.op_income,
      };
    });
  }, [basisEntries, basis, yearLabels]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">2. 전사 실적</h2>
        <BasisToggle value={basis} onChange={setBasis} />
      </header>
      <PnlTable leftHeaders={['연도']} rows={rows} />
    </section>
  );
}
