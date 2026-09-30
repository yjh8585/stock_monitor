'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';
import PnlTable, { type PnlTableRow } from './PnlTable';
import { aggregateBy, getMonthlyYears, ytdMonthsOfYear } from '@/lib/pnl/aggregate';
import type { AggregatedRow, Basis, DimensionKey, PnlEntry } from '@/lib/pnl/types';
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
 * 한 차원의 unique 값(전 기간 월별 행)을 선택 기간(1월~선택 월) 매출 desc(동률은 가나다) 순으로.
 * 선택 기간에 매출이 없는 값도 남겨야 기본 필터를 목록에서 해제할 수 있다(9-1과 같은 방식).
 */
function valuesByRevenue(
  allMonthly: readonly PnlEntry[],
  yearEntries: readonly PnlEntry[],
  dim: DimensionKey
): string[] {
  const all = new Set<string>();
  for (const e of allMonthly) {
    if (e.period_month >= 1 && e.period_month <= 12 && e[dim]) all.add(e[dim]);
  }
  const rev = new Map<string, number>();
  for (const r of aggregateBy(yearEntries, [dim])) {
    const v = r.dims[dim];
    if (v) rev.set(v, r.revenue);
  }
  return Array.from(all).sort(
    (a, b) => (rev.get(b) ?? 0) - (rev.get(a) ?? 0) || a.localeCompare(b, 'ko')
  );
}

/**
 * 9-2. 월별 고객·제품 실적 — 9-1과 같은 표를 선택한 연도의 1월~선택 월까지 월별로 보여 준다.
 *
 * - 연도·월 드롭다운 (디폴트 = basis의 최근 적재 연월). 선택값이 basis 토글·연도 변경으로 사라지면 최근 값으로 붙는다
 * - (고객·제품) 묶음마다 1월~선택 월 중 데이터가 있는 월만 행으로 나열(9-1의 연도 행과 같은 모양)
 * - 행 정렬: 고객 기간 매출 desc → 같은 고객 안에서 (고객·제품) 기간 매출 desc → 월 asc
 * - 맨 위에 선택(필터 통과) 행 전체의 「선택 합계」 한 행(기간 합 — 월별로 쪼개지 않는다)
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

  const yearEntries = useMemo(
    () =>
      basisMonthly.filter(
        (e) =>
          e.basis === basis &&
          e.period_year === year &&
          e.period_month >= 1 &&
          e.period_month <= month
      ),
    [basisMonthly, basis, year, month]
  );

  const revOrder = useMemo(
    () =>
      Object.fromEntries(
        DIMENSIONS.map((d) => [d.key, valuesByRevenue(basisMonthly, yearEntries, d.key)])
      ) as Record<string, string[]>,
    [basisMonthly, yearEntries]
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

  const rows: PnlTableRow[] = useMemo(() => {
    const filtered = yearEntries.filter((e) =>
      DIMENSIONS.every((d) => {
        const sel = selections[d.key] ?? [];
        return sel.length === 0 || sel.includes(e[d.key]);
      })
    );
    const dimKeys = DIMENSIONS.map((d) => d.key);
    // 데이터가 있는 월만 (1월~선택 월 중 적재된 월)
    const months = Array.from(new Set(filtered.map((e) => e.period_month))).sort((a, b) => a - b);
    const periodLabel = (m: number) => `${year}.${String(m).padStart(2, '0')}`;

    const toRow = (agg: AggregatedRow, labels: string[], m: number): PnlTableRow => ({
      key: `${agg.key} | ${m}`,
      labels,
      revenue: agg.revenue,
      material_cost: agg.material_cost,
      labor_cost: agg.labor_cost,
      expense: agg.expense,
      sga: agg.sga,
      rnd: agg.rnd,
      op_income: agg.op_income,
    });

    // (고객·제품) 묶음 순서 — 고객 기간 매출 desc → 같은 고객 안에서 (고객·제품) 기간 매출 desc
    const customerRank = new Map(revOrder.customer.map((v, i) => [v, i]));
    const combos = aggregateBy(filtered, dimKeys).sort((a, b) => {
      const ra = customerRank.get(a.dims.customer) ?? Number.POSITIVE_INFINITY;
      const rb = customerRank.get(b.dims.customer) ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return b.revenue - a.revenue;
    });

    // 월별 (고객·제품) 집계 — 묶음 key → 월 → 집계행
    const byCombo = new Map<string, Map<number, AggregatedRow>>();
    for (const m of months) {
      const monthRows = filtered.filter((e) => e.period_month === m);
      for (const agg of aggregateBy(monthRows, dimKeys)) {
        if (!byCombo.has(agg.key)) byCombo.set(agg.key, new Map());
        byCombo.get(agg.key)!.set(m, agg);
      }
    }

    const dataRows: PnlTableRow[] = [];
    for (const combo of combos) {
      const labels = DIMENSIONS.map((d) => combo.dims[d.key] || '(미분류)');
      for (const m of months) {
        const agg = byCombo.get(combo.key)?.get(m);
        if (agg) dataRows.push(toRow(agg, [...labels, periodLabel(m)], m));
      }
    }
    if (dataRows.length === 0) return dataRows;
    // 맨 위 합계 행 하나 — 필터를 통과한 행 전체(1월~선택 월)의 합
    const [total] = aggregateBy(filtered, []);
    const first = months[0];
    const last = months[months.length - 1];
    const totalPeriod =
      first === last
        ? periodLabel(first)
        : `${periodLabel(first)}~${String(last).padStart(2, '0')}`;
    return [
      { ...toRow(total, ['선택 합계', '─', totalPeriod], 0), isGrandTotal: true },
      ...dataRows,
    ];
  }, [yearEntries, selections, revOrder, year]);

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
            options={Array.from({ length: maxMonth }, (_, i) => monthLabel(i + 1))}
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
