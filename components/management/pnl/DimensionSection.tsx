'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';
import PnlTable, { type PnlTableRow } from './PnlTable';
import {
  aggregateBy,
  entriesForYear,
  getDisplayYearLabels,
  getUniqueValues,
} from '@/lib/pnl/aggregate';
import type { Basis, DimensionKey, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface DimensionConfig {
  key: DimensionKey;
  /** 표 헤더 라벨 (예: '부문') */
  label: string;
}

interface Props {
  /** 섹션 제목 (예: '2. 부문 실적') */
  title: string;
  /** 단일 차원 (부문/고객/제품) 또는 복합 차원 (제품·고객) */
  dimensions: DimensionConfig[];
  annualEntries: PnlEntry[];
  /** basis별로 미리 분리된 reference — 토글 시 작은 배열만 처리 */
  annualByBasis: EntriesByBasis;
}

/**
 * 2~5번 섹션 공통 구현.
 *
 * - basis 토글 + 각 차원에 대해 멀티 선택 필터
 * - 행: 차원 조합 × 연도, 열: 7개 지표
 * - 빈 값('') 차원은 row 라벨에 '(미분류)' 로 표시
 *
 * 성능: basis 토글 시 `annualByBasis[basis]` 작은 배열만 사용.
 */
export default function DimensionSection({ title, dimensions, annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  // 각 차원별 선택 상태 (Record<DimensionKey, string[]>)
  const [selections, setSelections] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(dimensions.map((d) => [d.key, [] as string[]]))
  );

  // basis 변경 시 선택값 초기화 — 차원 값 셋이 달라질 수 있어 stale 선택 방지
  // (예: 연결에는 있는 고객이 별도엔 없을 때)
  // 의도적으로 자동 초기화하지 않고, 필터 결과 0건이면 사용자가 직접 reset 가능하도록 둔다.

  /** 현재 basis의 작은 reference 배열 (전체 annualEntries 대신 절반만 처리) */
  const basisEntries = annualByBasis[basis];

  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );

  /** 각 차원의 unique 값 옵션 */
  const dimOptions = useMemo(() => {
    return Object.fromEntries(
      dimensions.map((d) => [d.key, getUniqueValues(basisEntries, d.key, basis)])
    ) as Record<DimensionKey, string[]>;
  }, [basisEntries, basis, dimensions]);

  /** 선택 토글 */
  const onToggle = (dim: DimensionKey, value: string) => {
    setSelections((prev) => {
      const current = prev[dim] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [dim]: next };
    });
  };

  /** 선택 reset */
  const onReset = (dim: DimensionKey) => {
    setSelections((prev) => ({ ...prev, [dim]: [] }));
  };

  /** 표 행 계산 */
  const rows: PnlTableRow[] = useMemo(() => {
    const dimKeys = dimensions.map((d) => d.key);
    const out: PnlTableRow[] = [];

    for (const yearLabel of yearLabels) {
      const yearEntries = entriesForYear(basisEntries, basis, yearLabel);
      const filtered = yearEntries.filter((e) => {
        for (const d of dimensions) {
          const sel = selections[d.key] ?? [];
          if (sel.length === 0) continue;
          if (!sel.includes(e[d.key])) return false;
        }
        return true;
      });
      const aggregated = aggregateBy(filtered, dimKeys);
      // 차원 조합별로 정렬 (한국어 로케일)
      aggregated.sort((a, b) => a.key.localeCompare(b.key, 'ko'));
      for (const agg of aggregated) {
        // 차원 라벨들 + 연도
        const dimLabels = dimensions.map((d) => agg.dims[d.key] || '(미분류)');
        out.push({
          key: `${yearLabel}|${agg.key}`,
          labels: [...dimLabels, yearLabel],
          revenue: agg.revenue,
          material_cost: agg.material_cost,
          labor_cost: agg.labor_cost,
          expense: agg.expense,
          sga: agg.sga,
          rnd: agg.rnd,
          op_income: agg.op_income,
        });
      }
    }
    // 행 정렬: 차원 우선, 연도 보조
    out.sort((a, b) => {
      const labelA = a.labels.slice(0, -1).join(' | ');
      const labelB = b.labels.slice(0, -1).join(' | ');
      if (labelA !== labelB) return labelA.localeCompare(labelB, 'ko');
      return a.labels[a.labels.length - 1].localeCompare(b.labels[b.labels.length - 1]);
    });
    return out;
  }, [basisEntries, basis, yearLabels, selections, dimensions]);

  const leftHeaders = useMemo(() => [...dimensions.map((d) => d.label), '연도'], [dimensions]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          {dimensions.map((d) => (
            <GroupMultiSelect
              key={d.key}
              label={d.label}
              options={dimOptions[d.key] ?? []}
              selected={selections[d.key] ?? []}
              onToggle={(v) => onToggle(d.key, v)}
              onReset={() => onReset(d.key)}
            />
          ))}
        </div>
      </header>
      <PnlTable leftHeaders={leftHeaders} rows={rows} />
    </section>
  );
}
