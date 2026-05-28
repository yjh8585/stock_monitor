'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { AchievementPoint, PlanRow } from '@/lib/plan/types';

/** 전사 손익 매출/영업이익 차트 공통 빌더 (계획=pnl_plan, 실적=pnl_entries). */
export function buildCorpAchievement(
  rows: PlanRow[],
  prepared: PreparedPnlData,
  basis: Basis,
  item: '매출' | '영업이익',
  metric: 'revenue' | 'op_income'
): AchievementPoint[] {
  const planRows = pick(rows, '손익', item, basis); // 계획만 존재
  const planPts = buildAchievement(planRows, { unit: '억원' });
  // 실적: pnl_entries 연간(+2026 YTD) 전사 합계 → 백만원이므로 ÷100 = 억원
  const annual = prepared.annualByBasis[basis];
  const labels = getDisplayYearLabels(annual, basis);
  const actualByYear = new Map<number, { value: number; ytd: boolean }>();
  for (const lbl of labels) {
    const yr = parseInt(lbl.slice(0, 4), 10);
    const agg = aggregateBy(entriesForYear(annual, basis, lbl), []);
    if (agg.length > 0) {
      actualByYear.set(yr, { value: agg[0][metric] / 100, ytd: lbl === '2026' });
    }
  }
  // 계획 연도 ∪ 실적 연도
  const years = new Set<number>([...planPts.map((p) => p.year), ...actualByYear.keys()]);
  const out: AchievementPoint[] = [];
  for (const year of Array.from(years).sort((a, b) => a - b)) {
    const plan = planPts.find((p) => p.year === year)?.plan ?? null;
    const a = actualByYear.get(year);
    const actual = a ? Math.round(a.value * 10000) / 10000 : null;
    const ytd = a?.ytd ?? false;
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
      title="2. 전사 매출목표 달성"
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
