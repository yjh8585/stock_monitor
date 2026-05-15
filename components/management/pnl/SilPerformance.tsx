'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import PnlTable, { type PnlTableRow } from './PnlTable';
import {
  aggregateBy,
  entriesForYear,
  getDisplayYearLabels,
  getUniqueValues,
} from '@/lib/pnl/aggregate';
import type { Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/**
 * 추가 1: 실별 손익.
 *
 * - basis 토글 + 단일 연도 선택 + 실 선택 (1실/2실/3실/...)
 * - 해당 실의 (고객 × 제품) 조합별 표
 *
 * 성능: basis 토글 시 `annualByBasis[basis]` 작은 배열만 사용.
 */
export default function SilPerformance({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');

  /** 현재 basis의 작은 reference 배열 */
  const basisEntries = annualByBasis[basis];

  // 연도 후보 — basis별
  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );

  // 기본 선택: 최신 연도
  const [yearLabel, setYearLabel] = useState<string>('');
  const effectiveYear = useMemo(() => {
    if (yearLabel && yearLabels.includes(yearLabel)) return yearLabel;
    return yearLabels[yearLabels.length - 1] ?? '';
  }, [yearLabel, yearLabels]);

  // 실 후보 — basis별 unique 값
  const silOptions = useMemo(
    () => getUniqueValues(basisEntries, 'sil', basis),
    [basisEntries, basis]
  );

  const [sil, setSil] = useState<string>('');
  const effectiveSil = useMemo(() => {
    if (sil && silOptions.includes(sil)) return sil;
    return silOptions[0] ?? '';
  }, [sil, silOptions]);

  // 표 행 계산 — 선택 연도 + 선택 실 → (고객, 제품) 조합별 합계
  const rows: PnlTableRow[] = useMemo(() => {
    if (!effectiveYear || !effectiveSil) return [];
    const yearEntries = entriesForYear(basisEntries, basis, effectiveYear);
    const filtered = yearEntries.filter((e) => e.sil === effectiveSil);
    const aggregated = aggregateBy(filtered, ['customer', 'product']);
    aggregated.sort((a, b) => b.revenue - a.revenue);
    return aggregated.map((r) => ({
      key: r.key,
      labels: [r.dims.customer || '(미분류)', r.dims.product || '(미분류)'],
      revenue: r.revenue,
      material_cost: r.material_cost,
      labor_cost: r.labor_cost,
      expense: r.expense,
      sga: r.sga,
      rnd: r.rnd,
      op_income: r.op_income,
    }));
  }, [basisEntries, basis, effectiveYear, effectiveSil]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-base font-semibold">추가 1. 실별 손익</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect
            label="연도"
            options={yearLabels}
            value={effectiveYear}
            onChange={setYearLabel}
          />
          <SilRadio options={silOptions} value={effectiveSil} onChange={setSil} />
        </div>
      </header>
      <PnlTable
        leftHeaders={['고객', '제품']}
        rows={rows}
        emptyText={
          silOptions.length === 0
            ? '실 정보가 없습니다.'
            : '선택한 조건에 해당하는 데이터가 없습니다.'
        }
      />
    </section>
  );
}

/** 실 선택 라디오 그룹 (가로 배치) */
function SilRadio({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (options.length === 0) {
    return <span className="text-xs text-muted-foreground">실 정보 없음</span>;
  }
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={`text-xs px-2.5 py-1 rounded-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
