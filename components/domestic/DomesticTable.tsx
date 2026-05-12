'use client';

import { useMemo, useState } from 'react';
import { DomesticStockRow, DomesticSortKey, ExchangeRates } from '@/lib/types';
import { buildFinancialColumns, getFinancialSortValue, resolveLatestYear } from '@/lib/stockSort';
import StickyTable, { StickyColumn, SortDir } from '@/components/common/StickyTable';
import DomesticFilterBar, { DomesticListingFilter } from './DomesticFilterBar';
import DomesticRow from './DomesticRow';

interface DomesticTableProps {
  rows: DomesticStockRow[];
  rates: ExchangeRates;
  /** 그룹 컬럼 라벨 (default '그룹'). /parts-top100에서는 '국가' 전달. */
  groupLabel?: string;
  /** 매출 순위 cutoff('전체' 토글) 활성화. /domestic에서만 true. */
  enableRankCutoff?: boolean;
}

const FROZEN_COUNT = 3;
const RANK_CUTOFF = 100;
const PINNED_COMPANY_NAME = '한세모빌리티';

/** /domestic, /parts-top100 좌측 컬럼 + 공통 재무 컬럼 결합 */
function buildColumns(latestYear: string, groupLabel: string): StickyColumn<DomesticSortKey>[] {
  return [
    { key: 'group_name', label: groupLabel, defaultWidth: 120 },
    { key: 'name_kr', label: '회사명', defaultWidth: 124 },
    { key: 'name_kr', label: '제품', defaultWidth: 280 },
    { key: 'name_kr', label: '고객사', defaultWidth: 224 },
    ...buildFinancialColumns<DomesticSortKey>(latestYear),
  ];
}

function getSortValue(
  row: DomesticStockRow,
  key: DomesticSortKey,
  latestYear: string
): string | number | null {
  switch (key) {
    case 'group_name':
      return row.group_name ?? '';
    case 'sales_rank':
      return row.sales_rank ?? null;
    case 'name_kr':
      return row.name_kr;
    default: {
      const v = getFinancialSortValue(row, key, latestYear);
      return v === undefined ? null : v;
    }
  }
}

/** 도메스틱 표 — 디폴트 정렬: sales_rank ASC (매출 1위가 위) */
export default function DomesticTable({
  rows,
  rates,
  groupLabel = '그룹',
  enableRankCutoff = false,
}: DomesticTableProps) {
  const [sortKey, setSortKey] = useState<DomesticSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [listingFilter, setListingFilter] = useState<DomesticListingFilter[]>(['상장', '비상장']);
  const [productQuery, setProductQuery] = useState('');
  const [showAllRows, setShowAllRows] = useState(false);

  /** 100위까지 + 한세모빌리티 순위(있으면). enableRankCutoff=false면 null. */
  const rankCutoff = useMemo(() => {
    if (!enableRankCutoff) return null;
    const pinnedRank = rows.find((r) => r.name_kr === PINNED_COMPANY_NAME)?.sales_rank ?? null;
    return Math.max(RANK_CUTOFF, pinnedRank ?? RANK_CUTOFF);
  }, [rows, enableRankCutoff]);

  const latestDataYear = useMemo(() => resolveLatestYear(rows), [rows]);
  const columns = useMemo(
    () => buildColumns(latestDataYear, groupLabel),
    [latestDataYear, groupLabel]
  );

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
    if (rankCutoff != null && !showAllRows) {
      result = result.filter((r) => r.sales_rank != null && r.sales_rank <= rankCutoff);
    }
    return result;
  }, [rows, groupFilter, listingFilter, productQuery, rankCutoff, showAllRows]);

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
        groupLabel={groupLabel}
        showAllToggle={rankCutoff != null}
        showAllRows={showAllRows}
        onShowAllToggle={() => setShowAllRows((v) => !v)}
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
