'use client';

import { useMemo, useState } from 'react';
import { RelatedStockRow, SortKey, ExchangeRates } from '@/lib/types';
import { useIsMobile } from '@/lib/useIsMobile';
import { buildFinancialColumns, getFinancialSortValue, resolveLatestYear } from '@/lib/stockSort';
import StickyTable, { StickyColumn, SortDir } from '@/components/common/StickyTable';
import FilterBar, {
  CompanyTypeFilter,
  ListingFilter,
  RegionFilter,
  ProductCategoryFilter,
} from './FilterBar';
import StockRow from './StockRow';

interface StockTableProps {
  rows: RelatedStockRow[];
  rates: ExchangeRates;
}

/** 고정 열 수 (구분 / 회사명 / 제품) */
const FROZEN_COUNT = 3;

/** /related-stocks 고유 좌측 컬럼 + 공통 재무 컬럼 결합 */
function buildColumns(latestYear: string): StickyColumn<SortKey>[] {
  return [
    { key: 'company_type', label: '구분', defaultWidth: 58 },
    { key: 'name_kr', label: '회사명', defaultWidth: 104 },
    { key: 'name_kr', label: '제품', defaultWidth: 280 },
    { key: 'name_kr', label: '고객사', defaultWidth: 224 },
    { key: 'region', label: '지역', defaultWidth: 60 },
    ...buildFinancialColumns<SortKey>(latestYear),
  ];
}

/** 페이지 고유 키만 분기 후 공통 헬퍼에 위임 */
function getSortValue(
  row: RelatedStockRow,
  key: SortKey,
  latestYear: string
): string | number | null {
  switch (key) {
    case 'company_type':
      return row.company_type ?? '';
    case 'name_kr':
      return row.name_kr;
    case 'region':
      return row.region ?? '';
    default: {
      const v = getFinancialSortValue(row, key, latestYear);
      return v === undefined ? null : v;
    }
  }
}

/** 관련주식 표 (정렬 · 필터 · 좌측 3열 고정) */
export default function StockTable({ rows, rates }: StockTableProps) {
  const isMobile = useIsMobile();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [typeFilter, setTypeFilter] = useState<CompanyTypeFilter[]>(['OEM', '부품사']);
  const [listingFilter, setListingFilter] = useState<ListingFilter[]>(['상장', '비상장']);
  const [regionFilter, setRegionFilter] = useState<RegionFilter[]>(['국내', '해외']);
  const [productCategoryFilter, setProductCategoryFilter] = useState<ProductCategoryFilter[]>([]);

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

  const handleProductCategoryToggle = (type: ProductCategoryFilter) =>
    setProductCategoryFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );

  const handleProductCategoryReset = () => setProductCategoryFilter([]);

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
    if (productCategoryFilter.length > 0) {
      // 제품군 카테고리는 부품사에만 적용 (OEM은 차종이라 카테고리 무관 — 항상 통과).
      result = result.filter((r) =>
        r.company_type !== '부품사' ||
        r.products.some((p) => productCategoryFilter.includes(p.category as ProductCategoryFilter))
      );
    }
    return result;
  }, [rows, typeFilter, listingFilter, regionFilter, productCategoryFilter]);

  const sorted = useMemo(() => {
    // 기본 정렬(sortKey=null): 부품사 먼저(매출 내림차순) → OEM(매출 내림차순)
    if (!sortKey) {
      const revKey = `rev_${latestDataYear}` as SortKey;
      const typeRank = (t: RelatedStockRow['company_type']) =>
        t === '부품사' ? 0 : t === 'OEM' ? 1 : 2;
      return [...filtered].sort((a, b) => {
        const tr = typeRank(a.company_type) - typeRank(b.company_type);
        if (tr !== 0) return tr;
        const av = getSortValue(a, revKey, latestDataYear);
        const bv = getSortValue(b, revKey, latestDataYear);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? 1 : av > bv ? -1 : 0;
      });
    }
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
        productCategoryFilter={productCategoryFilter}
        onTypeToggle={handleTypeToggle}
        onListingToggle={handleListingToggle}
        onRegionToggle={handleRegionToggle}
        onProductCategoryToggle={handleProductCategoryToggle}
        onProductCategoryReset={handleProductCategoryReset}
        rates={rates}
      />
      <StickyTable
        rows={sorted}
        columns={columns}
        frozenCount={isMobile ? 2 : FROZEN_COUNT}
        getRowKey={(row) => row.id}
        renderRow={(row, { colCount }) => (
          <StockRow
            row={row}
            latestYear={latestDataYear}
            colCount={colCount}
            frozenCount={isMobile ? 2 : FROZEN_COUNT}
          />
        )}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </div>
  );
}
