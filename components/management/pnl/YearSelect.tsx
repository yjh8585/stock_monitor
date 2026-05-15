'use client';

interface YearSelectProps {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
}

/**
 * 단일 연도 드롭다운 (native select 기반).
 *
 * - shadcn 스타일 작은 셀렉트
 * - 옵션이 0개면 disabled
 */
export default function YearSelect({ label, options, value, onChange }: YearSelectProps) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
        className="px-2 py-1 rounded-md border border-border bg-background text-foreground hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.length === 0 && <option value="">(없음)</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}
