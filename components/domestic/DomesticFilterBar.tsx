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
  /**
   * 제품군 카테고리 옵션. 생략 시 자동차 12종.
   * /humanoid 는 로봇 11종(types.ts ROBOT_PRODUCT_CATEGORIES)을 넘긴다.
   */
  productCategoryOptions?: readonly string[];
  /** 역할 버튼(휴머노이드/부품) 옵션. 생략하면 버튼 자체를 그리지 않는다. */
  roleOptions?: readonly { value: string; label: string }[];
  roleFilter?: readonly string[];
  onRoleToggle?: (value: string) => void;
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
  productCategoryOptions = PRODUCT_CATEGORY_OPTIONS,
  roleOptions,
  roleFilter = [],
  onRoleToggle,
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
      {roleOptions && onRoleToggle && (
        <>
          <span className="w-px h-4 bg-border mx-1 shrink-0" />
          <span className="text-sm font-medium text-muted-foreground shrink-0">역할</span>
          {roleOptions.map((opt) => {
            const active = roleFilter.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => onRoleToggle(opt.value)}
                className={`text-sm px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
                title="겸업사는 두 역할에 모두 나타난다"
              >
                {opt.label}
              </button>
            );
          })}
        </>
      )}
      <span className="w-px h-4 bg-border mx-1 shrink-0" />
      <span className="text-sm font-medium text-muted-foreground shrink-0">상장</span>
      {LISTING_OPTIONS.map((opt) => {
        const active = listingFilter.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onListingToggle(opt)}
            className={`text-sm px-2.5 py-1 rounded-full border transition-colors ${
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
          <span className="text-sm font-medium text-muted-foreground shrink-0">TOP100</span>
          <button
            type="button"
            aria-pressed={showAllRows}
            onClick={onShowAllToggle}
            className={`text-sm px-2.5 py-1 rounded-full border transition-colors ${
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
      <span className="text-sm font-medium text-muted-foreground shrink-0">제품군</span>
      <GroupMultiSelect
        label="카테고리"
        options={productCategoryOptions}
        selected={productCategoryFilter}
        onToggle={onProductCategoryToggle}
        onReset={onProductCategoryReset}
      />
      <span className="w-px h-4 bg-border mx-1 shrink-0" />
      <span className="text-sm font-medium text-muted-foreground shrink-0">제품</span>
      <div className="relative">
        <Input
          value={productQuery}
          onChange={(e) => onProductChange(e.target.value)}
          placeholder="제품 검색…"
          className="h-7 text-sm pr-6 w-36"
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
      <div className="ml-auto text-sm text-muted-foreground shrink-0">
        (매출 : 십억원, 시가총액 : 조원{rateLabel ? `, ${rateLabel}` : ''})
      </div>
    </div>
  );
}
