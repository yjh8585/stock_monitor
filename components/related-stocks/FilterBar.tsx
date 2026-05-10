'use client';

import { ExchangeRates } from '@/lib/types';
import { formatRateLabel } from '@/lib/format';
import ToggleFilterBar, { ToggleFilterGroup } from '@/components/common/ToggleFilterBar';

export type CompanyTypeFilter = 'OEM' | '부품사';
export type ListingFilter = '상장' | '비상장';
export type RegionFilter = '국내' | '해외';
export type ProductCategoryFilter = '하프샤프트' | '조향';

interface FilterBarProps {
  typeFilter: CompanyTypeFilter[];
  listingFilter: ListingFilter[];
  regionFilter: RegionFilter[];
  productCategoryFilter: ProductCategoryFilter[];
  onTypeToggle: (type: CompanyTypeFilter) => void;
  onListingToggle: (type: ListingFilter) => void;
  onRegionToggle: (type: RegionFilter) => void;
  onProductCategoryToggle: (type: ProductCategoryFilter) => void;
  rates: ExchangeRates;
}

const TYPE_OPTIONS: readonly CompanyTypeFilter[] = ['OEM', '부품사'];
const LISTING_OPTIONS: readonly ListingFilter[] = ['상장', '비상장'];
const REGION_OPTIONS: readonly RegionFilter[] = ['국내', '해외'];
const PRODUCT_CATEGORY_OPTIONS: readonly ProductCategoryFilter[] = ['하프샤프트', '조향'];

/** 관련회사 페이지 전용 필터 바 — ToggleFilterBar 위에 페이지 고유 환율 슬롯을 얹는다. */
export default function FilterBar({
  typeFilter,
  listingFilter,
  regionFilter,
  productCategoryFilter,
  onTypeToggle,
  onListingToggle,
  onRegionToggle,
  onProductCategoryToggle,
  rates,
}: FilterBarProps) {
  const rateLabel = formatRateLabel(rates);

  const groups: ToggleFilterGroup[] = [
    {
      label: '구분',
      options: TYPE_OPTIONS,
      selected: typeFilter,
      onToggle: (v) => onTypeToggle(v as CompanyTypeFilter),
    },
    {
      label: '상장',
      options: LISTING_OPTIONS,
      selected: listingFilter,
      onToggle: (v) => onListingToggle(v as ListingFilter),
    },
    {
      label: '지역',
      options: REGION_OPTIONS,
      selected: regionFilter,
      onToggle: (v) => onRegionToggle(v as RegionFilter),
    },
    {
      label: '제품군',
      options: PRODUCT_CATEGORY_OPTIONS,
      selected: productCategoryFilter,
      onToggle: (v) => onProductCategoryToggle(v as ProductCategoryFilter),
    },
  ];

  return (
    <ToggleFilterBar
      groups={groups}
      rightSlot={`(매출 : 십억원, 시가총액 : 조원${rateLabel ? `, ${rateLabel}` : ''})`}
    />
  );
}
