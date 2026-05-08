'use client';

import { useMemo, useState } from 'react';
import { DomesticStockRow, DomesticSortKey, ExchangeRates } from '@/lib/types';
import { calcCagr, invTurnover } from '@/lib/format';
import StickyTable, { StickyColumn, SortDir } from '@/components/common/StickyTable';
import DomesticFilterBar, { DomesticListingFilter } from './DomesticFilterBar';
import DomesticRow from './DomesticRow';

interface DomesticTableProps {
  rows: DomesticStockRow[];
  rates: ExchangeRates;
}

const FROZEN_COUNT = 3;

function resolveLatestYear(rows: DomesticStockRow[]): string {
  const candidates = ['2026', '2025', '2024', '2023'];
  for (const year of candidates) {
    if (rows.some((r) => r.financials_by_year?.[year]?.revenue != null)) return year;
  }
  return '2025';
}

function buildColumns(latestYear: string): StickyColumn<DomesticSortKey>[] {
  const yr = parseInt(latestYear);
  const y2 = latestYear.slice(2);
  const revenueYears = [yr - 2, yr - 1, yr];
  const opYears = [yr - 2, yr - 1, yr];

  return [
    { key: 'group_name', label: '그룹', defaultWidth: 100 },
    { key: 'name_kr', label: '회사명', defaultWidth: 124 },
    { key: 'name_kr', label: '제품', defaultWidth: 280 },
    { key: 'name_kr', label: '고객사', defaultWidth: 280 },
    ...revenueYears.map((y) => ({
      key: `rev_${y}` as DomesticSortKey,
      label: `'${String(y).slice(2)} 매출`,
      defaultWidth: 88,
    })),
    { key: 'cagr', label: '3yr CAGR', defaultWidth: 74 },
    ...opYears.map((y) => ({
      key: `op_${y}` as DomesticSortKey,
      label: `'${String(y).slice(2)} OP%`,
      defaultWidth: 68,
    })),
    { key: 'debt_ratio', label: `'${y2} 부채비율`, defaultWidth: 80 },
    { key: 'inv_turnover', label: `'${y2} 재고회전율`, defaultWidth: 92 },
    { key: 'last_price', label: '주가', defaultWidth: 80 },
    { key: 'market_cap_t', label: '시가총액', defaultWidth: 72 },
    { key: 'per', label: `'${y2} PER`, defaultWidth: 60 },
    { key: 'pbr', label: `'${y2} PBR`, defaultWidth: 60 },
    { key: 'ev_ebitda', label: `'${y2} EV/EBITDA`, defaultWidth: 90 },
  ];
}

function getSortValue(
  row: DomesticStockRow,
  key: DomesticSortKey,
  latestYear: string
): string | number | null {
  const fy = row.financials_by_year;
  const fxFin = row.fx_fin_to_krw ?? row.fx_to_krw ?? 1;
  const fxPrice = row.fx_to_krw ?? 1;
  const yr = parseInt(latestYear);

  const revKrw = (year: string) => {
    const r = fy?.[year]?.revenue;
    return r != null ? r * fxFin : null;
  };

  if (key.startsWith('rev_')) {
    return revKrw(key.slice(4));
  }
  if (key.startsWith('op_')) {
    return fy?.[key.slice(3)]?.operating_margin ?? null;
  }

  switch (key) {
    case 'group_name':
      return row.group_name ?? '';
    case 'sales_rank':
      return row.sales_rank ?? null;
    case 'name_kr':
      return row.name_kr;
    case 'cagr': {
      const r3ago = revKrw(String(yr - 3));
      const rLatest = revKrw(latestYear);
      if (r3ago != null && rLatest != null) return calcCagr(r3ago, rLatest, 3);
      return calcCagr(revKrw(String(yr - 2)), rLatest, 2);
    }
    case 'debt_ratio':
      return fy?.[latestYear]?.debt_ratio ?? null;
    case 'inv_turnover':
      return invTurnover(fy?.[latestYear]);
    case 'last_price':
      return row.last_price != null ? row.last_price * fxPrice : null;
    case 'market_cap_t':
      return row.market_cap;
    case 'per':
      return fy?.[latestYear]?.per ?? null;
    case 'pbr':
      return fy?.[latestYear]?.pbr ?? null;
    case 'ev_ebitda':
      return fy?.[latestYear]?.ev_ebitda ?? null;
    default:
      return null;
  }
}

/** 도메스틱 표 — 디폴트 정렬: sales_rank ASC (매출 1위가 위) */
export default function DomesticTable({ rows, rates }: DomesticTableProps) {
  const [sortKey, setSortKey] = useState<DomesticSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [listingFilter, setListingFilter] = useState<DomesticListingFilter[]>([]);
  const [productQuery, setProductQuery] = useState('');

  const latestDataYear = useMemo(() => resolveLatestYear(rows), [rows]);
  const columns = useMemo(() => buildColumns(latestDataYear), [latestDataYear]);

  // 그룹 옵션: rows에 등장하는 group_name (NULL 제외)
  const groupOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.group_name) set.add(r.group_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [rows]);

  const handleSort = (key: DomesticSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'sales_rank' || key === 'name_kr' || key === 'group_name' ? 'asc' : 'desc'
      );
    }
  };

  const handleGroupToggle = (g: string) =>
    setGroupFilter((prev) => (prev.includes(g) ? prev.filter((v) => v !== g) : [...prev, g]));

  const handleListingToggle = (v: DomesticListingFilter) =>
    setListingFilter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const filtered = useMemo(() => {
    let result = rows;
    if (groupFilter.length > 0) {
      result = result.filter((r) => r.group_name != null && groupFilter.includes(r.group_name));
    }
    if (listingFilter.length > 0) {
      result = result.filter((r) => {
        const isListed = r.market != null;
        return listingFilter.includes(isListed ? '상장' : '비상장');
      });
    }
    if (productQuery.trim()) {
      const q = productQuery.trim().toLowerCase();
      result = result.filter((r) => r.products.some((p) => p.name.toLowerCase().includes(q)));
    }
    return result;
  }, [rows, groupFilter, listingFilter, productQuery]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered; // 서버에서 sales_rank ASC 로 정렬되어 옴
    return [...filtered].sort((a, b) => {
      const av = getSortValue(a, sortKey, latestDataYear);
      const bv = getSortValue(b, sortKey, latestDataYear);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, latestDataYear]);

  return (
    <div className="flex flex-col h-full">
      <DomesticFilterBar
        groupOptions={groupOptions}
        groupFilter={groupFilter}
        listingFilter={listingFilter}
        productQuery={productQuery}
        onGroupToggle={handleGroupToggle}
        onGroupReset={() => setGroupFilter([])}
        onListingToggle={handleListingToggle}
        onProductChange={setProductQuery}
        rates={rates}
      />
      <StickyTable
        rows={sorted}
        columns={columns}
        frozenCount={FROZEN_COUNT}
        getRowKey={(row) => row.id}
        renderRow={(row, { colCount }) => (
          <DomesticRow row={row} latestYear={latestDataYear} colCount={colCount} />
        )}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </div>
  );
}
