'use client';

import { cn } from '@/lib/utils';
import type { RangeKey } from '@/lib/seriesRange';

export type { RangeKey };

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: '5y', label: '5Y' },
];

interface RangeToggleProps {
  value: RangeKey;
  onChange: (v: RangeKey) => void;
}

/** 1d/1m/3m/ytd/1y/5y 토글 — 차트 단위 사용 */
export default function RangeToggle({ value, onChange }: RangeToggleProps) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
      {RANGES.map(({ key, label }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            className={cn(
              'px-2 py-0.5 text-[11px] font-medium rounded transition-colors',
              active
                ? 'bg-background text-foreground ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
