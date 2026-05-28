'use client';

import type React from 'react';
import type { PlanRow } from '@/lib/plan/types';

/** 작은 토글 버튼 그룹 (단일 선택). 다른 차트의 BasisToggle 스타일과 통일. */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-sm transition-colors ${
            value === o.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-background hover:bg-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 차트 섹션 래퍼 (번호 h2 + 단위 부기 + 우측 컨트롤 슬롯). 단위는 경영관리 페이지와 동일한 muted-foreground 스타일. */
export function ChartSection({
  title,
  unit,
  controls,
  children,
}: {
  title: string;
  /** 차트 단위 표기 (예: '억원', 'USD 백만'). 제공 시 제목 옆에 ` · 단위 XX` 형태로 렌더. */
  unit?: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">
          {title}
          {unit ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">· 단위 {unit}</span>
          ) : null}
        </h2>
        {controls ? <div className="flex items-center gap-2 flex-wrap">{controls}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** (category,item,basis) 필터 헬퍼 — 래퍼에서 재사용. */
export function pick(
  rows: readonly PlanRow[],
  category: string,
  item: string,
  basis: PlanRow['basis']
): PlanRow[] {
  return rows.filter((r) => r.category === category && r.item === item && r.basis === basis);
}
