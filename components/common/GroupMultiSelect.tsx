'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

interface GroupMultiSelectProps {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (g: string) => void;
  onReset: () => void;
}

/** 다중선택 드롭다운 — 외부 클릭 시 자동으로 닫힘 */
export default function GroupMultiSelect({
  label,
  options,
  selected,
  onToggle,
  onReset,
}: GroupMultiSelectProps) {
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
        <div className="absolute z-50 top-full left-0 mt-1 w-44 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1">
          <button
            onClick={onReset}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground border-b border-border mb-1"
          >
            <span className="w-4 h-4 flex items-center justify-center">
              {selected.length === 0 && <Check size={12} />}
            </span>
            <span>전체</span>
          </button>
          {options.map((g) => {
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
          })}
        </div>
      )}
    </div>
  );
}
