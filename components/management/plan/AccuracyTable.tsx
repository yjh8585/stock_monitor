'use client';

import { useMemo } from 'react';
import { ChartSection } from './_selectors';
import { EXTENDED_ACCURACY_KPIS, buildAccuracyStats } from '@/lib/plan/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { PlanRow } from '@/lib/plan/types';

function fmt(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** 평균 달성률 색상 — 90 미만 적색, 110 초과 청색, 그 외 무색. */
function avgCls(avg: number | null): string {
  if (avg === null) return '';
  if (avg < 90) return 'text-red-500 font-medium';
  if (avg > 110) return 'text-blue-600 font-medium';
  return '';
}

/**
 * 11. KPI별 정확도 분포 — 9행(EXTENDED) × 5컬럼.
 *
 * - 정렬: 표준편차 내림차순 (들쭉날쭉 항목 위로).
 * - 색상: 평균 < 90% 적색, > 110% 청색.
 * - 표 폼은 다른 PnL/Plan 차트와 동일한 ring + rounded-xl card.
 */
export default function AccuracyTable({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const stats = useMemo(
    () => buildAccuracyStats(rows, prepared, EXTENDED_ACCURACY_KPIS),
    [rows, prepared]
  );
  return (
    <ChartSection title="11. KPI별 정확도 분포" unit="%">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 px-2">KPI</th>
              <th className="text-right py-1.5 px-2">평균 달성률</th>
              <th className="text-right py-1.5 px-2">표준편차</th>
              <th className="text-right py-1.5 px-2">최고</th>
              <th className="text-right py-1.5 px-2">최저</th>
              <th className="text-right py-1.5 px-2">연도수</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.key} className="border-b border-border/50">
                <td className="py-1.5 px-2">{s.label}</td>
                <td className={`text-right py-1.5 px-2 ${avgCls(s.avg)}`}>{fmt(s.avg)}</td>
                <td className="text-right py-1.5 px-2">{fmt(s.std)}</td>
                <td className="text-right py-1.5 px-2 text-emerald-600">{fmt(s.max)}</td>
                <td className="text-right py-1.5 px-2 text-red-500">{fmt(s.min)}</td>
                <td className="text-right py-1.5 px-2 text-muted-foreground">{s.count}</td>
              </tr>
            ))}
            {stats.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  데이터 없음
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        평균 90% 미만 적색(보수적 계획) · 110% 초과 청색(공격적 계획). 표준편차 내림차순 정렬.
      </p>
    </ChartSection>
  );
}
