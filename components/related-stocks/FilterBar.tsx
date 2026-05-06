'use client';

import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';

export type CompanyTypeFilter = 'OEM' | '부품사';

interface FilterBarProps {
  typeFilter: CompanyTypeFilter[];
  productQuery: string;
  onTypeToggle: (type: CompanyTypeFilter) => void;
  onProductChange: (q: string) => void;
}

const TYPE_OPTIONS: CompanyTypeFilter[] = ['OEM', '부품사'];

/** 구분(OEM/부품사) 멀티토글 + 제품 텍스트 검색 필터 바 */
export default function FilterBar({
  typeFilter,
  productQuery,
  onTypeToggle,
  onProductChange,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground shrink-0">구분</span>
      {TYPE_OPTIONS.map((type) => {
        const active = typeFilter.includes(type);
        return (
          <button
            key={type}
            onClick={() => onTypeToggle(type)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {type}
          </button>
        );
      })}
      <span className="text-xs font-medium text-muted-foreground shrink-0 ml-3">제품</span>
      <div className="relative">
        <Input
          value={productQuery}
          onChange={(e) => onProductChange(e.target.value)}
          placeholder="제품 검색…"
          className="h-7 w-36 text-xs pr-6"
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
      <span className="ml-auto text-xs text-muted-foreground shrink-0">
        (매출 : 십억원, 시가총액 : 조원, 현재환율 적용)
      </span>
    </div>
  );
}
