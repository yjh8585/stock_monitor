'use client';

import { ExchangeRates } from '@/lib/types';
import { formatRateLabel } from '@/lib/format';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';

export type CompanyTypeFilter = 'OEM' | '부품사';
export type ListingFilter = '상장' | '비상장';
export type RegionFilter = '국내' | '해외';
export type ProductCategoryFilter =
  | '엔진'
  | '구동계'
  | '제동'
  | '조향'
  | '차체'
  | '내장'
  | '전장'
  | '배터리'
  | '타이어'
  | '공조'
  | '안전'
  | '기타';

const TYPE_OPTIONS: readonly CompanyTypeFilter[] = ['OEM', '부품사'];
const LISTING_OPTIONS: readonly ListingFilter[] = ['상장', '비상장'];
const REGION_OPTIONS: readonly RegionFilter[] = ['국내', '해외'];
const PRODUCT_CATEGORY_OPTIONS: readonly ProductCategoryFilter[] = [
  '엔진', '구동계', '제동', '조향', '차체', '내장',
  '전장', '배터리', '타이어', '공조', '안전', '기타',
];

interface FilterBarProps {
  typeFilter: CompanyTypeFilter[];
  listingFilter: ListingFilter[];
  regionFilter: RegionFilter[];
  productCategoryFilter: ProductCategoryFilter[];
  onTypeToggle: (type: CompanyTypeFilter) => void;
  onListingToggle: (type: ListingFilter) => void;
  onRegionToggle: (type: RegionFilter) => void;
  onProductCategoryToggle: (type: ProductCategoryFilter) => void;
  onProductCategoryReset: () => void;
  rates: ExchangeRates;
}

function ToggleBtn({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'border-border text-muted-foreground hover:border-primary/50'
      }`}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-border mx-1 shrink-0" />;
}

function GroupLabel({ label }: { label: string }) {
  return <span className="text-xs font-medium text-muted-foreground shrink-0">{label}</span>;
}

/** 관련회사 페이지 전용 필터 바 */
export default function FilterBar({
  typeFilter,
  listingFilter,
  regionFilter,
  productCategoryFilter,
  onTypeToggle,
  onListingToggle,
  onRegionToggle,
  onProductCategoryToggle,
  onProductCategoryReset,
  rates,
}: FilterBarProps) {
  const rateLabel = formatRateLabel(rates);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
      <GroupLabel label="구분" />
      {TYPE_OPTIONS.map((opt) => (
        <ToggleBtn
          key={opt}
          label={opt}
          active={typeFilter.includes(opt)}
          onToggle={() => onTypeToggle(opt)}
        />
      ))}
      <Divider />
      <GroupLabel label="상장" />
      {LISTING_OPTIONS.map((opt) => (
        <ToggleBtn
          key={opt}
          label={opt}
          active={listingFilter.includes(opt)}
          onToggle={() => onListingToggle(opt)}
        />
      ))}
      <Divider />
      <GroupLabel label="지역" />
      {REGION_OPTIONS.map((opt) => (
        <ToggleBtn
          key={opt}
          label={opt}
          active={regionFilter.includes(opt)}
          onToggle={() => onRegionToggle(opt)}
        />
      ))}
      <Divider />
      <GroupLabel label="제품군" />
      <GroupMultiSelect
        label="카테고리"
        options={PRODUCT_CATEGORY_OPTIONS}
        selected={productCategoryFilter}
        onToggle={(v) => onProductCategoryToggle(v as ProductCategoryFilter)}
        onReset={onProductCategoryReset}
      />
      <div className="ml-auto text-xs text-muted-foreground shrink-0">
        (매출 : 십억원, 시가총액 : 조원{rateLabel ? `, ${rateLabel}` : ''})
      </div>
    </div>
  );
}
