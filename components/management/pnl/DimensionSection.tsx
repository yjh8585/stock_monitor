'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';
import PnlTable, { type PnlTableRow } from './PnlTable';
import {
  aggregateBy,
  entriesForYear,
  getDisplayYearLabels,
  getUniqueValuesByRevenue,
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
  /** 초기 선택값 (사용자 요구: 섹션별 기본 필터). 키 미지정 차원은 빈 배열. */
  defaultSelections?: Partial<Record<DimensionKey, string[]>>;
}

/**
 * 2~5번 섹션 공통 구현.
 *
 * - basis 토글 + 각 차원에 대해 멀티 선택 필터
 * - 행: 차원 조합 × 연도. 1차 차원 매출-desc → 2차 차원 매출-desc → ... → 연도 asc 순으로 정렬
 * - 옵션도 최근 연도 매출-desc 순으로 정렬
 * - 차원 컬럼은 PnlTable에서 rowspan 병합 + 1차 차원 경계에 굵은 테두리
 *
 * 성능: basis 토글 시 `annualByBasis[basis]` 작은 배열만 사용.
 */
export default function DimensionSection({
  title,
  dimensions,
  annualByBasis,
  defaultSelections,
}: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const [selections, setSelections] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      dimensions.map((d) => [d.key, defaultSelections?.[d.key] ?? ([] as string[])])
    )
  );

  /** 현재 basis의 작은 reference 배열 */
  const basisEntries = annualByBasis[basis];

  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );

  /** 최근 연도 (옵션·행 정렬 기준) */
  const latestYear = yearLabels[yearLabels.length - 1] ?? '';

  /** 각 차원의 unique 값 (최근 연도 매출-desc 정렬) */
  const revOrder = useMemo(() => {
    const obj: Partial<Record<DimensionKey, string[]>> = {};
    for (const d of dimensions) {
      obj[d.key] = latestYear
        ? getUniqueValuesByRevenue(basisEntries, d.key, basis, latestYear)
        : [];
    }
    return obj as Record<DimensionKey, string[]>;
  }, [basisEntries, basis, dimensions, latestYear]);

  /** 1차 차원 값 → 전역 rank (0 = 매출 1위). 2차 이상은 parent 그룹 내에서 combo 매출로 정렬한다. */
  const primaryRank = useMemo(() => {
    if (dimensions.length === 0) return new Map<string, number>();
    return new Map(revOrder[dimensions[0].key].map((v, i) => [v, i]));
  }, [revOrder, dimensions]);

  /**
   * 최근 연도 기준 full dim combination별 매출.
   * key 포맷은 `aggregateBy` 결과의 r.key와 동일: `dims.join(' | ')`.
   * 2차+ 차원 정렬에 사용 — 같은 1차 그룹 안에서 (1차+2차+...) 조합 매출 desc.
   */
  const latestComboRevenue = useMemo(() => {
    const m = new Map<string, number>();
    if (!latestYear || dimensions.length <= 1) return m;
    const latest = entriesForYear(basisEntries, basis, latestYear);
    const agg = aggregateBy(
      latest,
      dimensions.map((d) => d.key)
    );
    for (const r of agg) m.set(r.key, r.revenue);
    return m;
  }, [basisEntries, basis, dimensions, latestYear]);

  const onToggle = (dim: DimensionKey, value: string) => {
    setSelections((prev) => {
      const current = prev[dim] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [dim]: next };
    });
  };

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
      for (const agg of aggregated) {
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
    // 정렬: 1차 차원 전역 rank → 같은 1차 그룹 내 combo 매출 desc → 연도 asc
    const denorm = (lbl: string) => (lbl === '(미분류)' ? '' : lbl);
    out.sort((a, b) => {
      if (dimensions.length > 0) {
        const aKey1 = denorm(a.labels[0]);
        const bKey1 = denorm(b.labels[0]);
        const aRank1 = primaryRank.get(aKey1);
        const bRank1 = primaryRank.get(bKey1);
        const aR1 = aRank1 == null ? Number.POSITIVE_INFINITY : aRank1;
        const bR1 = bRank1 == null ? Number.POSITIVE_INFINITY : bRank1;
        if (aR1 !== bR1) return aR1 - bR1;
      }
      if (dimensions.length > 1) {
        // full combo key (aggregateBy의 r.key 포맷)
        const aCombo = dimensions.map((_, i) => denorm(a.labels[i])).join(' | ');
        const bCombo = dimensions.map((_, i) => denorm(b.labels[i])).join(' | ');
        const aRev = latestComboRevenue.get(aCombo) ?? 0;
        const bRev = latestComboRevenue.get(bCombo) ?? 0;
        if (aRev !== bRev) return bRev - aRev;
      }
      const aY = a.labels[a.labels.length - 1] ?? '';
      const bY = b.labels[b.labels.length - 1] ?? '';
      return aY.localeCompare(bY);
    });
    return out;
  }, [basisEntries, basis, yearLabels, selections, dimensions, primaryRank, latestComboRevenue]);

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
              options={revOrder[d.key] ?? []}
              selected={selections[d.key] ?? []}
              onToggle={(v) => onToggle(d.key, v)}
              onReset={() => onReset(d.key)}
            />
          ))}
        </div>
      </header>
      <PnlTable leftHeaders={leftHeaders} rows={rows} dimCount={dimensions.length} />
    </section>
  );
}
