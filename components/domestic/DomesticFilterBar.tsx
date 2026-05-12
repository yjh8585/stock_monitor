'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { ExchangeRates } from '@/lib/types';
import { formatRateLabel } from '@/lib/format';
import { Input } from '@/components/ui/input';

export type DomesticListingFilter = '상장' | '비상장';

const LISTING_OPTIONS: readonly DomesticListingFilter[] = ['상장', '비상장'];

interface DomesticFilterBarProps {
  groupOptions: readonly string[];
  groupFilter: readonly string[];
  listingFilter: readonly DomesticListingFilter[];
  productQuery: string;
  onGroupToggle: (group: string) => void;
  onGroupReset: () => void;
  onListingToggle: (v: DomesticListingFilter) => void;
  onProductChange: (q: string) => void;
  rates: ExchangeRates;
  /** 그룹 다중선택 드롭다운 라벨 (default '그룹'). /parts-top100에서는 '국가' 사용. */
  groupLabel?: string;
  /** '전체' 토글 버튼 표시 여부. /domestic에서만 true. */
  showAllToggle?: boolean;
  /** 전체 행 표시 활성 여부. */
  showAllRows?: boolean;
  onShowAllToggle?: () => void;
}

/** 그룹 다중선택 드롭다운 — 외부 클릭 시 닫힘 */
function GroupMultiSelect({
  label,
  options,
  selected,
  onToggle,
  onReset,
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (g: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const summary =
    selected.length === 0
      ? '전체'
      : selected.length === 1
        ? selected[0]
        : `${selected.length}개 선택`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-border text-foreground hover:border-primary/50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>
          {label}: {summary}
        </span>
        {selected.length > 0 && (
          <X
            size={12}
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
          />
        )}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-48 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">그룹 없음</div>
          ) : (
            options.map((g) => {
              const active = selected.includes(g);
              return (
                <button
                  key={g}
                  onClick={() => onToggle(g)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="w-4 h-4 flex items-center justify-center">
                    {active && <Check size={12} />}
                  </span>
                  <span className="truncate">{g}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function DomesticFilterBar({
  groupOptions,
  groupFilter,
  listingFilter,
  productQuery,
  onGroupToggle,
  onGroupReset,
  onListingToggle,
  onProductChange,
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
      )}
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
