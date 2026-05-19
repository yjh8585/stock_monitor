'use client';

import type { Basis } from '@/lib/pnl/types';

interface BasisToggleProps {
  value: Basis;
  onChange: (next: Basis) => void;
}

const OPTIONS: { value: Basis; label: string }[] = [
  { value: 'consolidated', label: '연결' },
  { value: 'standalone', label: '별도' },
];

/**
 * 연결/별도 2-state 토글.
 *
 * - shadcn 스타일 작은 버튼 그룹
 * - aria-pressed 로 접근성 확보
 */
export default function BasisToggle({ value, onChange }: BasisToggleProps) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`text-sm px-2.5 py-1 rounded-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
