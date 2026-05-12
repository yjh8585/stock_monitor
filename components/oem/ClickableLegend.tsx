'use client';

import { OEM_COLORS } from './helpers';

interface Props {
  items: string[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}

/** 차트 위 가로 범례 — 큰 순(왼쪽) 강제, 클릭 시 hide 토글. Recharts 자동 정렬 우회용. */
export default function ClickableLegend({ items, hidden, onToggle }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs px-2">
      {items.map((label, i) => {
        const isHidden = hidden.has(label);
        const color = OEM_COLORS[i % OEM_COLORS.length];
        return (
          <button
            key={label}
            type="button"
            onClick={() => onToggle(label)}
            className="flex items-center gap-1.5 cursor-pointer select-none"
            style={{ opacity: isHidden ? 0.35 : 1 }}
            aria-pressed={isHidden}
          >
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            <span
              className="text-foreground"
              style={{ textDecoration: isHidden ? 'line-through' : 'none' }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
