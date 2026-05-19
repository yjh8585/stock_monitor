'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import PnlTable, { type PnlTableRow } from './PnlTable';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { AggregatedRow, Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

/** 실 라벨에서 앞의 숫자를 추출. 숫자가 없으면 null. */
function parseSilNumber(label: string): number | null {
  const m = label.match(/(\d+)\s*실/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * 같은 모회사 그룹사를 하나의 그룹으로 묶는 매핑.
 * - 정렬 시 같은 그룹의 고객들이 연속 배치되도록 사용.
 * - 그 외 고객은 자기 자신이 그룹.
 */
const CUSTOMER_GROUP_MAP: Record<string, string> = {
  'Stellantis NA': 'Stellantis',
  'Stellantis EU': 'Stellantis',
  'VW NA': 'Volkswagen',
  'VW EU': 'Volkswagen',
  Porsche: 'Volkswagen',
};

function customerGroupOf(customer: string): string {
  return CUSTOMER_GROUP_MAP[customer] ?? customer;
}

/** 실 옵션 정렬: 1실 → 2실 → 3실 → ... → 그 외(기타 포함, 가나다순) */
function sortSilOptions(labels: readonly string[]): string[] {
  return [...labels].sort((a, b) => {
    const na = parseSilNumber(a);
    const nb = parseSilNumber(b);
    if (na != null && nb != null) return na - nb;
    if (na != null) return -1;
    if (nb != null) return 1;
    return a.localeCompare(b, 'ko');
  });
}

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/**
 * 7. 실별 손익.
 *
 * - basis 토글 + 단일 연도 선택 + 실 선택 (1실/2실/3실/...)
 * - 해당 실의 (고객 × 제품) 조합별 표 — 매출-desc 정렬
 * - 맨 위에 해당 실 전체 합계 행 (isSummary)
 *
 * 성능: basis 토글 시 `annualByBasis[basis]` 작은 배열만 사용.
 */
export default function SilPerformance({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');

  const basisEntries = annualByBasis[basis];

  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );

  const [yearLabel, setYearLabel] = useState<string>('');
  const effectiveYear = useMemo(() => {
    if (yearLabel && yearLabels.includes(yearLabel)) return yearLabel;
    return yearLabels[yearLabels.length - 1] ?? '';
  }, [yearLabel, yearLabels]);

  /** 실 옵션 — 1실 → 2실 → 3실 → 기타 순 (basis 필터 + period_month=0 연간 행에서 unique 추출) */
  const silOptions = useMemo(() => {
    if (!effectiveYear) return [];
    const set = new Set<string>();
    for (const e of basisEntries) {
      if (e.basis !== basis) continue;
      if (e.period_month !== 0) continue;
      if (typeof e.sil === 'string' && e.sil.length > 0) set.add(e.sil);
    }
    return sortSilOptions(Array.from(set));
  }, [basisEntries, basis, effectiveYear]);

  const [sil, setSil] = useState<string>('');
  const effectiveSil = useMemo(() => {
    if (sil && silOptions.includes(sil)) return sil;
    return silOptions[0] ?? '';
  }, [sil, silOptions]);

  /** 표 행 — (고객, 제품) 조합 매출-desc + 맨 위 합계 행 */
  const rows: PnlTableRow[] = useMemo(() => {
    if (!effectiveYear || !effectiveSil) return [];
    const yearEntries = entriesForYear(basisEntries, basis, effectiveYear);
    const filtered = yearEntries.filter((e) => e.sil === effectiveSil);
    const aggregated = aggregateBy(filtered, ['customer', 'product']);

    // 정렬 규칙:
    //  1) 모회사 그룹별로 묶음 (Stellantis NA/EU = Stellantis, VW NA/EU/Porsche = Volkswagen 등)
    //  2) 그룹 간: 그룹 총 매출 desc
    //  3) 그룹 내 customer 간: customer 총 매출 desc
    //  4) 동일 customer 내 product: 매출 desc
    const groupRevenue = new Map<string, number>();
    const customerRevenue = new Map<string, number>();
    for (const r of aggregated) {
      const g = customerGroupOf(r.dims.customer);
      groupRevenue.set(g, (groupRevenue.get(g) ?? 0) + r.revenue);
      customerRevenue.set(r.dims.customer, (customerRevenue.get(r.dims.customer) ?? 0) + r.revenue);
    }
    aggregated.sort((a, b) => {
      const ga = customerGroupOf(a.dims.customer);
      const gb = customerGroupOf(b.dims.customer);
      if (ga !== gb) {
        return (groupRevenue.get(gb) ?? 0) - (groupRevenue.get(ga) ?? 0);
      }
      if (a.dims.customer !== b.dims.customer) {
        return (customerRevenue.get(b.dims.customer) ?? 0) - (customerRevenue.get(a.dims.customer) ?? 0);
      }
      return b.revenue - a.revenue;
    });

    if (aggregated.length === 0) return [];

    // 그룹 → customer → product 순으로 partition (정렬 순서 유지)
    type CustomerBucket = { customer: string; rows: AggregatedRow[] };
    type GroupBucket = { groupName: string; customers: CustomerBucket[] };
    const groups: GroupBucket[] = [];
    {
      let cg: GroupBucket | null = null;
      let cc: CustomerBucket | null = null;
      for (const r of aggregated) {
        const g = customerGroupOf(r.dims.customer);
        if (!cg || cg.groupName !== g) {
          cg = { groupName: g, customers: [] };
          groups.push(cg);
          cc = null;
        }
        if (!cc || cc.customer !== r.dims.customer) {
          cc = { customer: r.dims.customer, rows: [] };
          cg.customers.push(cc);
        }
        cc.rows.push(r);
      }
    }

    /** AggregatedRow 다수 → 7개 지표 합계 */
    const sumOf = (items: AggregatedRow[]) => ({
      revenue: items.reduce((s, r) => s + r.revenue, 0),
      material_cost: items.reduce((s, r) => s + r.material_cost, 0),
      labor_cost: items.reduce((s, r) => s + r.labor_cost, 0),
      expense: items.reduce((s, r) => s + r.expense, 0),
      sga: items.reduce((s, r) => s + r.sga, 0),
      rnd: items.reduce((s, r) => s + r.rnd, 0),
      op_income: items.reduce((s, r) => s + r.op_income, 0),
    });

    /**
     * 데이터 행 구성:
     *  - 그룹 customer ≥ 2 → 해당 그룹 상단에 그룹 합계 행 (예: "Stellantis 합계")
     *  - customer product ≥ 2 → 해당 customer 상단에 customer 합계 행 (예: "Stellantis NA / 합계")
     *  - 이후 (customer, product) 행들 매출 desc
     */
    const dataRows: PnlTableRow[] = [];
    for (const g of groups) {
      if (g.customers.length >= 2) {
        const allRows = g.customers.flatMap((c) => c.rows);
        dataRows.push({
          key: `__group__${g.groupName}__`,
          labels: [`${g.groupName} 합계`, '─'],
          ...sumOf(allRows),
          isSummary: true,
        });
      }
      for (const c of g.customers) {
        if (c.rows.length >= 2) {
          dataRows.push({
            key: `__cust__${c.customer}__`,
            labels: [c.customer || '(미분류)', '합계'],
            ...sumOf(c.rows),
            isSummary: true,
          });
        }
        for (const r of c.rows) {
          dataRows.push({
            key: r.key,
            labels: [c.customer || '(미분류)', r.dims.product || '(미분류)'],
            revenue: r.revenue,
            material_cost: r.material_cost,
            labor_cost: r.labor_cost,
            expense: r.expense,
            sga: r.sga,
            rnd: r.rnd,
            op_income: r.op_income,
          });
        }
      }
    }

    // 전체 합계 행 — 그룹/customer 소계가 dataRows에 섞여 있으므로 원본 aggregated에서 합산.
    const totalRow: PnlTableRow = {
      key: '__total__',
      labels: ['전체 합계', '─'],
      ...sumOf(aggregated),
      isGrandTotal: true,
    };
    return [totalRow, ...dataRows];
  }, [basisEntries, basis, effectiveYear, effectiveSil]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">7. 실별 손익</h2>
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
        dimCount={2}
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
    return <span className="text-sm text-muted-foreground">실 정보 없음</span>;
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
            className={`text-sm px-2.5 py-1 rounded-sm transition-colors ${
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
