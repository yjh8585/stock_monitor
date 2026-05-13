'use client';

import { ExchangeRates } from '@/lib/types';
import { formatRateLabel } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';

export type DomesticListingFilter = '상장' | '비상장';

const LISTING_OPTIONS: readonly DomesticListingFilter[] = ['상장', '비상장'];
const PRODUCT_CATEGORY_OPTIONS = [
  '엔진',
  '구동계',
  '제동',
  '조향',
  '차체',
  '내장',
  '전장',
  '배터리',
  '타이어',
  '공조',
  '안전',
  '기타',
] as const;

interface DomesticFilterBarProps {
  groupOptions: readonly string[];
  groupFilter: readonly string[];
  listingFilter: readonly DomesticListingFilter[];
  productQuery: string;
  productCategoryFilter: readonly string[];
  onGroupToggle: (group: string) => void;
  onGroupReset: () => void;
  onListingToggle: (v: DomesticListingFilter) => void;
  onProductChange: (q: string) => void;
  onProductCategoryToggle: (cat: string) => void;
  onProductCategoryReset: () => void;
  rates: ExchangeRates;
  /** 그룹 다중선택 드롭다운 라벨 (default '그룹'). /parts-top100에서는 '국가' 사용. */
  groupLabel?: string;
  /** '전체' 토글 버튼 표시 여부. /domestic에서만 true. */
  showAllToggle?: boolean;
  /** 전체 행 표시 활성 여부. */
  showAllRows?: boolean;
  onShowAllToggle?: () => void;
}

export default function DomesticFilterBar({
  groupOptions,
  groupFilter,
  listingFilter,
  productQuery,
  productCategoryFilter,
  onGroupToggle,
  onGroupReset,
  onListingToggle,
  onProductChange,
  onProductCategoryToggle,
  onProductCategoryReset,
  rates,
  groupLabel = '그룹',
  showAllToggle = false,
  showAllRows = false,
  onShowAllToggle,
}: DomesticFilterBarProps) {
  const rateLabel = formatRateLabel(rates);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
      <GroupMultiSelect
        label={groupLabel}
        options={groupOptions}
        selected={groupFilter}
        onToggle={onGroupToggle}
        onReset={onGroupReset}
      />
      <span className="w-px h-4 bg-border mx-1 shrink-0" />
      <span className="text-xs font-medium text-muted-foreground shrink-0">상장</span>
      {LISTING_OPTIONS.map((opt) => {
        const active = listingFilter.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onListingToggle(opt)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {opt}
          </button>
        );
      })}
      {showAllToggle && onShowAllToggle && (
        <>
          <span className="w-px h-4 bg-border mx-1 shrink-0" />
          <span className="text-xs font-medium text-muted-foreground shrink-0">TOP100</span>
          <button
            type="button"
            aria-pressed={showAllRows}
            onClick={onShowAllToggle}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              showAllRows
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
            title="기본 100위 + 한세모빌리티만 표시 / 클릭 시 전체 표시"
          >
            전체
          </button>
        </>
      )}
      <span className="w-px h-4 bg-border mx-1 shrink-0" />
      <span className="text-xs font-medium text-muted-foreground shrink-0">제품군</span>
      <GroupMultiSelect
        label="카테고리"
        options={PRODUCT_CATEGORY_OPTIONS}
        selected={productCategoryFilter}
        onToggle={onProductCategoryToggle}
        onReset={onProductCategoryReset}
      />
      <span className="w-px h-4 bg-border mx-1 shrink-0" />
      <span className="text-xs font-medium text-muted-foreground shrink-0">제품</span>
      <div className="relative">
        <Input
          value={productQuery}
          onChange={(e) => onProductChange(e.target.value)}
          placeholder="제품 검색…"
          className="h-7 text-xs pr-6 w-36"
        />
        {productQuery && (
          <button
            onClick={() => onProductChange('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="ml-auto text-xs text-muted-foreground shrink-0">
        (매출 : 십억원, 시가총액 : 조원{rateLabel ? `, ${rateLabel}` : ''})
      </div>
    </div>
  );
}
