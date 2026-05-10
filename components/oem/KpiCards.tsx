'use client';

import { useMemo } from 'react';
import { fmtChange, arrowColor, growthPct } from '@/lib/format';
import type { OemSalesGroupMonth } from '@/lib/types';
import { findLatestYm, fmtUnits } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

/** 글로벌 KPI 4장: 2024 / 2025 / 2026 YTD + YoY */
export default function KpiCards({ groupMonth }: Props) {
  const kpis = useMemo(() => {
    let sum2023 = 0;
    let sum2024 = 0;
    let sum2025 = 0;
    let sum2026Ytd = 0;
    let sum2025SamePeriod = 0;

    const latestYm2026 = findLatestYm(groupMonth, 2026) ?? 0;
    const latestMonth = latestYm2026 % 100;
    const samePeriodEnd = 202500 + latestMonth;

    for (const r of groupMonth) {
      const yr = Math.floor(r.year_month / 100);
      if (yr === 2023) sum2023 += r.sales;
      else if (yr === 2024) sum2024 += r.sales;
      else if (yr === 2025) sum2025 += r.sales;
      if (yr === 2026 && r.year_month <= latestYm2026) sum2026Ytd += r.sales;
      if (yr === 2025 && r.year_month >= 202501 && r.year_month <= samePeriodEnd) {
        sum2025SamePeriod += r.sales;
      }
    }

    return {
      sum2024,
      sum2025,
      sum2026Ytd,
      latestMonth,
      yoy2024: growthPct(sum2024, sum2023),
      yoy2025: growthPct(sum2025, sum2024),
      yoy2026Ytd: growthPct(sum2026Ytd, sum2025SamePeriod),
    };
  }, [groupMonth]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard label="2024년 글로벌 합계" value={kpis.sum2024} yoy={kpis.yoy2024} sub="vs 2023" />
      <KpiCard label="2025년 글로벌 합계" value={kpis.sum2025} yoy={kpis.yoy2025} sub="vs 2024" />
      <KpiCard
        label={`2026 YTD (1~${kpis.latestMonth}월)`}
        value={kpis.sum2026Ytd}
        yoy={kpis.yoy2026Ytd}
        sub="vs 2025 동기"
      />
      <KpiCard
        label="2025 일평균 판매"
        value={Math.round(kpis.sum2025 / 365)}
        yoy={null}
        sub="365일 기준"
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  yoy,
  sub,
}: {
  label: string;
  value: number;
  yoy: number | null;
  sub: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{fmtUnits(value)}</div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-muted-foreground">{sub}</span>
        {yoy != null && (
          <span className={`text-xs font-medium tabular-nums ${arrowColor(yoy)}`}>
            {fmtChange(yoy)}
          </span>
        )}
      </div>
    </div>
  );
}
