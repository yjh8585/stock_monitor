'use client';

import { useMemo, useState } from 'react';
import { RelatedStockRow, SortKey, ExchangeRates } from '@/lib/types';
import { calcCagr, invTurnover } from '@/lib/format';
import StickyTable, { StickyColumn, SortDir } from '@/components/common/StickyTable';
import FilterBar, { CompanyTypeFilter, ListingFilter, RegionFilter } from './FilterBar';
import StockRow from './StockRow';

interface StockTableProps {
  rows: RelatedStockRow[];
  rates: ExchangeRates;
}

/** 고정 열 수 (구분 / 회사명 / 제품) */
const FROZEN_COUNT = 3;

/** 데이터가 존재하는 가장 최근 연도 결정 */
function resolveLatestYear(rows: RelatedStockRow[]): string {
  const candidates = ['2026', '2025', '2024', '2023'];
  for (const year of candidates) {
    if (rows.some((r) => r.financials_by_year?.[year]?.revenue != null)) return year;
  }
  return '2025';
}

/** latestYear 기반으로 컬럼 정의 생성 */
function buildColumns(latestYear: string): StickyColumn<SortKey>[] {
  const yr = parseInt(latestYear);
  const y2 = latestYear.slice(2); // '25'
  const revenueYears = [yr - 2, yr - 1, yr];
  const opYears = [yr - 2, yr - 1, yr];

  return [
    { key: 'company_type', label: '구분', defaultWidth: 58 },
    { key: 'name_kr', label: '회사명', defaultWidth: 104 },
    { key: 'name_kr', label: '제품', defaultWidth: 280 },
    { key: 'name_kr', label: '고객사', defaultWidth: 280 },
    { key: 'region', label: '지역', defaultWidth: 60 },
    ...revenueYears.map((y) => ({
      key: `rev_${y}` as SortKey,
      label: `'${String(y).slice(2)} 매출`,
      defaultWidth: 88,
    })),
    { key: 'cagr', label: '3yr CAGR', defaultWidth: 74 },
    ...opYears.map((y) => ({
      key: `op_${y}` as SortKey,
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

/** 행에서 정렬용 숫자 추출 */
function getSortValue(
  row: RelatedStockRow,
  key: SortKey,
  latestYear: string
): string | number | null {
  const fy = row.financials_by_year;
  const fxFin = row.fx_fin_to_krw ?? row.fx_to_krw ?? 1; // 매출/이익 환산
  const fxPrice = row.fx_to_krw ?? 1; // 주가 환산
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
    case 'company_type':
      return row.company_type ?? '';
    case 'name_kr':
      return row.name_kr;
    case 'region':
      return row.region ?? '';
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

/** 관련주식 표 (정렬 · 필터 · 좌측 3열 고정) */
export default function StockTable({ rows, rates }: StockTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [typeFilter, setTypeFilter] = useState<CompanyTypeFilter[]>(['OEM', '부품사']);
  const [listingFilter, setListingFilter] = useState<ListingFilter[]>(['상장', '비상장']);
  const [regionFilter, setRegionFilter] = useState<RegionFilter[]>(['국내', '해외']);
  const [productQuery, setProductQuery] = useState('');

  // 데이터가 존재하는 최근 연도 (2026년 데이터 수집 시 자동 반영)
  const latestDataYear = useMemo(() => resolveLatestYear(rows), [rows]);
  const columns = useMemo(() => buildColumns(latestDataYear), [latestDataYear]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleTypeToggle = (type: CompanyTypeFilter) =>
    setTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );

  const handleListingToggle = (type: ListingFilter) =>
    setListingFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );

  const handleRegionToggle = (type: RegionFilter) =>
    setRegionFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );

  const filtered = useMemo(() => {
    let result = rows;
    if (typeFilter.length > 0) {
      result = result.filter(
        (r) => r.company_type && typeFilter.includes(r.company_type as CompanyTypeFilter)
      );
    }
    if (listingFilter.length < 2) {
      const wantListed = listingFilter.includes('상장');
      result = result.filter((r) => (r.market != null) === wantListed);
    }
    if (regionFilter.length < 2) {
      const wantDomestic = regionFilter.includes('국내');
      result = result.filter((r) => (r.country === 'KR') === wantDomestic);
    }
    if (productQuery.trim()) {
      const q = productQuery.trim().toLowerCase();
      result = result.filter((r) => r.products.some((p) => p.name.toLowerCase().includes(q)));
    }
    return result;
  }, [rows, typeFilter, listingFilter, regionFilter, productQuery]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
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
      <FilterBar
        typeFilter={typeFilter}
        listingFilter={listingFilter}
        regionFilter={regionFilter}
        productQuery={productQuery}
        onTypeToggle={handleTypeToggle}
        onListingToggle={handleListingToggle}
        onRegionToggle={handleRegionToggle}
        onProductChange={setProductQuery}
        rates={rates}
      />
      <StickyTable
        rows={sorted}
        columns={columns}
        frozenCount={FROZEN_COUNT}
        getRowKey={(row) => row.id}
        renderRow={(row, { colCount }) => (
          <StockRow row={row} latestYear={latestDataYear} colCount={colCount} />
        )}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </div>
  );
}
