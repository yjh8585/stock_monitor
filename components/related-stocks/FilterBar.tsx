'use client';

import { ExchangeRates } from '@/lib/types';
import ToggleFilterBar, { ToggleFilterGroup } from '@/components/common/ToggleFilterBar';

export type CompanyTypeFilter = 'OEM' | '부품사';
export type ListingFilter = '상장' | '비상장';
export type RegionFilter = '국내' | '해외';

interface FilterBarProps {
  typeFilter: CompanyTypeFilter[];
  listingFilter: ListingFilter[];
  regionFilter: RegionFilter[];
  productQuery: string;
  onTypeToggle: (type: CompanyTypeFilter) => void;
  onListingToggle: (type: ListingFilter) => void;
  onRegionToggle: (type: RegionFilter) => void;
  onProductChange: (q: string) => void;
  rates: ExchangeRates;
}

const TYPE_OPTIONS: readonly CompanyTypeFilter[] = ['OEM', '부품사'];
const LISTING_OPTIONS: readonly ListingFilter[] = ['상장', '비상장'];
const REGION_OPTIONS: readonly RegionFilter[] = ['국내', '해외'];

/** 환율 안내 문자열 — 통화별 누락 시 해당 항목 생략 */
function formatRateLabel(rates: ExchangeRates): string {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
  const parts: string[] = [];
  if (rates.USD != null) parts.push(`${fmt(rates.USD)}원/달러`);
  if (rates.EUR != null) parts.push(`${fmt(rates.EUR)}원/유로`);
  if (rates.CNY != null) parts.push(`${fmt(rates.CNY)}원/위안`);
  return parts.join(', ');
}

/** 관련회사 페이지 전용 필터 바 — ToggleFilterBar 위에 페이지 고유 환율 슬롯을 얹는다. */
export default function FilterBar({
  typeFilter,
  listingFilter,
  regionFilter,
  productQuery,
  onTypeToggle,
  onListingToggle,
  onRegionToggle,
  onProductChange,
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
  ];

  return (
    <ToggleFilterBar
      groups={groups}
      search={{
        label: '제품',
        placeholder: '제품 검색…',
        value: productQuery,
        onChange: onProductChange,
      }}
      rightSlot={`(매출 : 십억원, 시가총액 : 조원${rateLabel ? `, ${rateLabel}` : ''})`}
    />
  );
}
