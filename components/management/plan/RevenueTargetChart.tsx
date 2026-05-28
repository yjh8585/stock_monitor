'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { AchievementPoint, PlanRow } from '@/lib/plan/types';

/**
 * 전사 손익 매출/영업이익 차트 공통 빌더.
 *
 * - 계획(plan)은 pnl_plan(category='손익').
 * - 실적(actual)은 pnl_entries(dimensional) 우선. 해당 연도가 pnl_entries에 없으면
 *   pnl_plan의 actual 행(수동 입력된 과거 실적, 예: 2021/2022)으로 fallback.
 */
export function buildCorpAchievement(
  rows: PlanRow[],
  prepared: PreparedPnlData,
  basis: Basis,
  item: '매출' | '영업이익',
  metric: 'revenue' | 'op_income'
): AchievementPoint[] {
  const planRows = pick(rows, '손익', item, basis); // 계획 + (직접 입력된) 실적 행 모두
  const planPts = buildAchievement(planRows, { unit: '억원' });
  // pnl_entries 연간(+2026 YTD) 전사 합계 → 백만원이므로 ÷100 = 억원
  const annual = prepared.annualByBasis[basis];
  const labels = getDisplayYearLabels(annual, basis);
  const entriesActualByYear = new Map<number, { value: number; ytd: boolean }>();
  for (const lbl of labels) {
    const yr = parseInt(lbl.slice(0, 4), 10);
    const agg = aggregateBy(entriesForYear(annual, basis, lbl), []);
    if (agg.length > 0) {
      entriesActualByYear.set(yr, { value: agg[0][metric] / 100, ytd: lbl === '2026' });
    }
  }
  // 연도 합집합 (pnl_plan 연도 ∪ pnl_entries 연도)
  const years = new Set<number>([...planPts.map((p) => p.year), ...entriesActualByYear.keys()]);
  const out: AchievementPoint[] = [];
  for (const year of Array.from(years).sort((a, b) => a - b)) {
    const pp = planPts.find((p) => p.year === year);
    const plan = pp?.plan ?? null;
    // 실적: pnl_entries 우선, 없으면 pnl_plan의 actual로 fallback (2021/2022 등 과거 직접입력)
    let actual: number | null = null;
    let ytd = false;
    const e = entriesActualByYear.get(year);
    if (e) {
      actual = Math.round(e.value * 10000) / 10000;
      ytd = e.ytd;
    } else if (pp?.actual !== null && pp?.actual !== undefined) {
      actual = pp.actual;
    }
    const rate =
      plan && plan !== 0 && actual !== null ? Math.round((actual / plan) * 1000000) / 10000 : null;
    if (plan === null && actual === null) continue;
    out.push({ yearLabel: ytd ? `${year} YTD` : String(year), year, ytd, plan, actual, rate });
  }
  return out;
}

export default function RevenueTargetChart({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const points = useMemo(
    () => buildCorpAchievement(rows, prepared, basis, '매출', 'revenue'),
    [rows, prepared, basis]
  );
  return (
    <ChartSection
      title="3. 전사 매출목표 달성"
      unit="억원"
      controls={
        <ToggleGroup
          options={[
            { value: 'consolidated', label: '연결' },
            { value: 'standalone', label: '별도' },
          ]}
          value={basis}
          onChange={setBasis}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}
