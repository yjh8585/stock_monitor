'use client';

export type ProductionDimension = 'brand' | 'company';

interface Props {
  dimension: ProductionDimension;
  onChange: (d: ProductionDimension) => void;
}

/** 연간 생산·시장점유율 차트의 집계 기준(브랜드/회사) 토글. */
export default function UzbekistanDimensionToggle({ dimension, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="집계 기준 선택"
      className="mb-3 flex items-center gap-2 text-sm"
    >
      {(['brand', 'company'] as const).map((d) => (
        <button
          key={d}
          role="tab"
          type="button"
          aria-selected={dimension === d}
          onClick={() => onChange(d)}
          className={`rounded-md border px-3 py-1 transition-colors ${
            dimension === d
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          {d === 'brand' ? '브랜드' : '회사'}
        </button>
      ))}
    </div>
  );
}
