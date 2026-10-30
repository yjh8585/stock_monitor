'use client';

export type ProductionDimension = 'brand' | 'company';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  dimension: T;
  onChange: (d: T) => void;
  /** 선택지 — 기본 브랜드/회사. 중국 탭은 중국 모회사/브랜드 */
  options?: readonly Option<T>[];
}

const DEFAULT_OPTIONS: readonly Option<ProductionDimension>[] = [
  { value: 'brand', label: '브랜드' },
  { value: 'company', label: '회사' },
];

/** 연간 생산·시장점유율 차트의 집계 기준(브랜드/회사) 토글. */
export default function UzbekistanDimensionToggle<T extends string = ProductionDimension>({
  dimension,
  onChange,
  // 기본값은 T 가 ProductionDimension 일 때만 맞다 — 다른 T 를 쓰는 화면은 options 를 넘긴다
  options = DEFAULT_OPTIONS as unknown as readonly Option<T>[],
}: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label="집계 기준 선택"
      className="mb-3 flex items-center gap-2 text-sm"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={dimension === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-3 py-1 transition-colors ${
            dimension === o.value
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
