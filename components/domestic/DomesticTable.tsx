'use client';

import { useMemo, useState } from 'react';
import {
  DomesticStockRow,
  DomesticSortKey,
  ExchangeRates,
  ROBOT_PRODUCT_CATEGORIES,
  ROBOT_ROLE_LABELS,
} from '@/lib/types';
import { useIsMobile } from '@/lib/useIsMobile';
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
  /**
   * 표 변형. 'humanoid'면 세 가지가 한꺼번에 바뀐다 —
   *   ① 고객사 컬럼 미표시(수집하지 않는 항목)
   *   ② 역할 버튼(휴머노이드/부품) 표시 + robot_roles 필터
   *   ③ 제품군 카테고리를 로봇 11종으로, 필터 적용 대상 판정도 robot_roles 기준으로
   * 스위치를 쪼개지 않고 하나로 묶은 이유: 호출부에서 인자 하나를 빠뜨려 기능이
   * 조용히 죽는 사고를 막기 위해서다.
   */
  variant?: 'domestic' | 'humanoid';
}

const FROZEN_COUNT = 3;
const RANK_CUTOFF = 100;
const PINNED_COMPANY_NAME = '한세모빌리티';

const ROLE_OPTIONS = [
  { value: 'humanoid', label: ROBOT_ROLE_LABELS.humanoid },
  { value: 'parts', label: ROBOT_ROLE_LABELS.parts },
] as const;

/** /domestic, /parts-top100, /humanoid 좌측 컬럼 + 공통 재무 컬럼 결합 */
function buildColumns(
  latestYear: string,
  groupLabel: string,
  showCustomers: boolean
): StickyColumn<DomesticSortKey>[] {
  return [
    { key: 'group_name', label: groupLabel, defaultWidth: 120 },
    { key: 'name_kr', label: '회사명', defaultWidth: 124 },
    { key: 'name_kr', label: '제품', defaultWidth: 280 },
    // 고객사 자리 — 휴머노이드에서는 고객사를 수집하지 않으므로 비상장 기업가치를 대신 싣는다.
    showCustomers
      ? { key: 'name_kr' as DomesticSortKey, label: '고객사', defaultWidth: 224 }
      : { key: 'name_kr' as DomesticSortKey, label: '기업가치', defaultWidth: 150 },
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
  variant = 'domestic',
}: DomesticTableProps) {
  const isHumanoid = variant === 'humanoid';
  const isMobile = useIsMobile();
  const [sortKey, setSortKey] = useState<DomesticSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [listingFilter, setListingFilter] = useState<DomesticListingFilter[]>(['상장', '비상장']);
  const [productQuery, setProductQuery] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState<string[]>([]);
  const [roleFilter, setRoleFilter] = useState<string[]>(['humanoid', 'parts']);
  const [showAllRows, setShowAllRows] = useState(false);

  /** 100위까지 + 한세모빌리티 순위(있으면). enableRankCutoff=false면 null. */
  const rankCutoff = useMemo(() => {
    if (!enableRankCutoff) return null;
    const pinnedRank = rows.find((r) => r.name_kr === PINNED_COMPANY_NAME)?.sales_rank ?? null;
    return Math.max(RANK_CUTOFF, pinnedRank ?? RANK_CUTOFF);
  }, [rows, enableRankCutoff]);

  const latestDataYear = useMemo(() => resolveLatestYear(rows), [rows]);
  // 고객사는 휴머노이드 페이지에서 수집하지 않는다 → 컬럼 자체를 그리지 않는다.
  const showCustomers = !isHumanoid;
  const columns = useMemo(
    () => buildColumns(latestDataYear, groupLabel, showCustomers),
    [latestDataYear, groupLabel, showCustomers]
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

  const handleRoleToggle = (v: string) =>
    setRoleFilter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

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
    if (isHumanoid && roleFilter.length > 0 && roleFilter.length < ROLE_OPTIONS.length) {
      // 역할 태그가 비어 있는 행은 숨기지 않는다 — 필터가 데이터 결함을 감추면 안 된다.
      result = result.filter((r) => {
        const roles = r.robot_roles ?? [];
        return roles.length === 0 || roles.some((role) => roleFilter.includes(role));
      });
    }
    if (productCategoryFilter.length > 0) {
      // 제품군 카테고리는 부품 공급사에만 적용한다.
      //   /domestic·/parts-top100 : OEM 은 차종 표기라 카테고리 무관 → 항상 통과
      //   /humanoid               : 완성품 전용사(robot_roles 에 'parts' 없음)도 항상 통과
      //                             — company_type 으로 판정하면 완성품사가 전부 새어 나간다.
      result = result.filter((r) => {
        const isPartsSupplier = isHumanoid
          ? (r.robot_roles ?? []).includes('parts')
          : r.company_type === '부품사';
        return (
          !isPartsSupplier ||
          r.products.some((p) => productCategoryFilter.includes(p.category ?? '기타'))
        );
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
  }, [
    rows,
    groupFilter,
    listingFilter,
    productQuery,
    productCategoryFilter,
    roleFilter,
    isHumanoid,
    rankCutoff,
    showAllRows,
  ]);

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
        productCategoryFilter={productCategoryFilter}
        onGroupToggle={handleGroupToggle}
        onGroupReset={() => setGroupFilter([])}
        onListingToggle={handleListingToggle}
        onProductChange={setProductQuery}
        onProductCategoryToggle={(cat) =>
          setProductCategoryFilter((prev) =>
            prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
          )
        }
        onProductCategoryReset={() => setProductCategoryFilter([])}
        rates={rates}
        groupLabel={groupLabel}
        showAllToggle={rankCutoff != null}
        showAllRows={showAllRows}
        onShowAllToggle={() => setShowAllRows((v) => !v)}
        productCategoryOptions={isHumanoid ? ROBOT_PRODUCT_CATEGORIES : undefined}
        roleOptions={isHumanoid ? ROLE_OPTIONS : undefined}
        roleFilter={roleFilter}
        onRoleToggle={isHumanoid ? handleRoleToggle : undefined}
      />
      <StickyTable
        rows={sorted}
        columns={columns}
        frozenCount={isMobile ? 2 : FROZEN_COUNT}
        getRowKey={(row) => row.id}
        renderRow={(row, { colCount }) => (
          <DomesticRow
            row={row}
            latestYear={latestDataYear}
            colCount={colCount}
            frozenCount={isMobile ? 2 : FROZEN_COUNT}
            showCustomers={showCustomers}
          />
        )}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </div>
  );
}
