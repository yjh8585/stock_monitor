'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';
import PnlTable, { type PnlTableRow } from './PnlTable';
import { aggregateBy, getMonthlyYears, ytdMonthsOfYear } from '@/lib/pnl/aggregate';
import type { Basis, DimensionKey, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  monthlyByBasis: EntriesByBasis;
}

const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: 'customer', label: '고객' },
  { key: 'product', label: '제품' },
];

/** 9-1과 같은 기본 필터 */
const DEFAULT_SELECTIONS: Record<string, string[]> = {
  customer: ['Stellantis NA', 'VW NA'],
  product: ['HALFSHAFT'],
};

const monthLabel = (m: number) => `${m}월`;

/**
 * 한 차원의 unique 값(전 기간 월별 행)을 선택 월 매출 desc(동률은 가나다) 순으로.
 * 선택 월에 매출이 없는 값도 남겨야 기본 필터를 목록에서 해제할 수 있다(9-1과 같은 방식).
 */
function valuesByRevenue(
  allMonthly: readonly PnlEntry[],
  monthEntries: readonly PnlEntry[],
  dim: DimensionKey
): string[] {
  const all = new Set<string>();
  for (const e of allMonthly) {
    if (e.period_month >= 1 && e.period_month <= 12 && e[dim]) all.add(e[dim]);
  }
  const rev = new Map<string, number>();
  for (const r of aggregateBy(monthEntries, [dim])) {
    const v = r.dims[dim];
    if (v) rev.set(v, r.revenue);
  }
  return Array.from(all).sort(
    (a, b) => (rev.get(b) ?? 0) - (rev.get(a) ?? 0) || a.localeCompare(b, 'ko')
  );
}

/**
 * 9-2. 월별 고객·제품 실적 — 9-1과 같은 표를 선택한 연·월 한 달치로 보여 준다.
 *
 * - 연도·월 드롭다운 (디폴트 = basis의 최근 적재 연월)
 * - 선택한 연월이 basis 토글·연도 변경으로 사라지면 그 연도의 최근 월로 붙는다
 * - 행 정렬: 고객 매출 desc → 같은 고객 안에서 (고객·제품) 매출 desc
 */
export default function ProductCustomerMonthly({ monthlyByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const [pickedMonth, setPickedMonth] = useState<number | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>(DEFAULT_SELECTIONS);

  const basisMonthly = monthlyByBasis[basis];
  const years = useMemo(() => getMonthlyYears(basisMonthly, basis), [basisMonthly, basis]);

  const latestYear = years[years.length - 1] ?? 0;
  const year = pickedYear != null && years.includes(pickedYear) ? pickedYear : latestYear;
  const maxMonth = ytdMonthsOfYear(basisMonthly, basis, year);
  const month =
    pickedMonth != null && pickedMonth >= 1 && pickedMonth <= maxMonth ? pickedMonth : maxMonth;

  const monthEntries = useMemo(
    () =>
      basisMonthly.filter(
        (e) => e.basis === basis && e.period_year === year && e.period_month === month
      ),
    [basisMonthly, basis, year, month]
  );

  const revOrder = useMemo(
    () =>
      Object.fromEntries(
        DIMENSIONS.map((d) => [d.key, valuesByRevenue(basisMonthly, monthEntries, d.key)])
      ) as Record<string, string[]>,
    [basisMonthly, monthEntries]
  );

  const onToggle = (dim: DimensionKey, value: string) => {
    setSelections((prev) => {
      const current = prev[dim] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [dim]: next };
    });
  };

  const onReset = (dim: DimensionKey) => {
    setSelections((prev) => ({ ...prev, [dim]: [] }));
  };

  const periodLabel = `${year}.${String(month).padStart(2, '0')}`;

  const rows: PnlTableRow[] = useMemo(() => {
    const filtered = monthEntries.filter((e) =>
      DIMENSIONS.every((d) => {
        const sel = selections[d.key] ?? [];
        return sel.length === 0 || sel.includes(e[d.key]);
      })
    );
    const aggregated = aggregateBy(
      filtered,
      DIMENSIONS.map((d) => d.key)
    );
    const customerRank = new Map(revOrder.customer.map((v, i) => [v, i]));
    aggregated.sort((a, b) => {
      const ra = customerRank.get(a.dims.customer) ?? Number.POSITIVE_INFINITY;
      const rb = customerRank.get(b.dims.customer) ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return b.revenue - a.revenue;
    });
    return aggregated.map((agg) => ({
      key: agg.key,
      labels: [...DIMENSIONS.map((d) => agg.dims[d.key] || '(미분류)'), periodLabel],
      revenue: agg.revenue,
      material_cost: agg.material_cost,
      labor_cost: agg.labor_cost,
      expense: agg.expense,
      sga: agg.sga,
      rnd: agg.rnd,
      op_income: agg.op_income,
    }));
  }, [monthEntries, selections, revOrder, periodLabel]);

  const monthOptions = Array.from({ length: maxMonth }, (_, i) => monthLabel(i + 1));

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">
          9-2. 월별 고객·제품 실적{' '}
          <span className="text-sm font-normal text-muted-foreground">· 단위 백만원</span>
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect
            label="연도"
            options={years.map(String)}
            value={String(year)}
            onChange={(v) => setPickedYear(Number(v))}
          />
          <YearSelect
            label="월"
            options={monthOptions}
            value={monthLabel(month)}
            onChange={(v) => setPickedMonth(parseInt(v, 10))}
          />
          {DIMENSIONS.map((d) => (
            <GroupMultiSelect
              key={d.key}
              label={d.label}
              options={revOrder[d.key] ?? []}
              selected={selections[d.key] ?? []}
              onToggle={(v) => onToggle(d.key, v)}
              onReset={() => onReset(d.key)}
            />
          ))}
        </div>
      </header>
      <PnlTable
        leftHeaders={[...DIMENSIONS.map((d) => d.label), '연월']}
        rows={rows}
        dimCount={DIMENSIONS.length}
      />
    </section>
  );
}
