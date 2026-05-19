'use client';

import { Fragment } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';

export interface ToggleFilterGroup {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}

interface SearchProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  width?: string;
}

interface ToggleFilterBarProps {
  groups: ToggleFilterGroup[];
  search?: SearchProps;
  /** 우측 정렬 영역 (예: 환율/단위 안내 라벨) */
  rightSlot?: React.ReactNode;
}

function ToggleGroup({ label, options, selected, onToggle }: ToggleFilterGroup) {
  return (
    <>
      <span className="text-sm font-medium text-muted-foreground shrink-0">{label}</span>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(opt)}
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
    </>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-border mx-1 shrink-0" />;
}

/**
 * 토글 그룹 + 검색 + 우측 슬롯으로 구성된 공통 필터 바.
 * 페이지별 환율/단위 안내 등은 rightSlot으로 주입한다.
 */
export default function ToggleFilterBar({ groups, search, rightSlot }: ToggleFilterBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
      {groups.map((g, i) => (
        <Fragment key={g.label}>
          <ToggleGroup {...g} />
          {(i < groups.length - 1 || search) && <Divider />}
        </Fragment>
      ))}
      {search && (
        <>
          <span className="text-sm font-medium text-muted-foreground shrink-0">{search.label}</span>
          <div className="relative">
            <Input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              className={`h-7 text-sm pr-6 ${search.width ?? 'w-36'}`}
            />
            {search.value && (
              <button
                onClick={() => search.onChange('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </>
      )}
      {rightSlot && (
        <div className="ml-auto text-sm text-muted-foreground shrink-0">{rightSlot}</div>
      )}
    </div>
  );
}
