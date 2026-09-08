'use client';

import { useMemo } from 'react';
import { fmtChange, arrowColor, growthPct } from '@/lib/format';
import type { OemSalesGroupMonth } from '@/lib/types';
import { currentYear } from '@/lib/currentYear';
import { targetYear } from '@/lib/oem/aggregate';
import { findLatestYm, fmtUnits } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

/** 글로벌 KPI 4장: 직전 완결 연도 -1 / 직전 완결 연도 / 진행 연도 YTD + YoY */
export default function KpiCards({ groupMonth }: Props) {
  const kpis = useMemo(() => {
    const tgt = targetYear();
    const prevYr = tgt - 1;
    const prevPrevYr = tgt - 2;
    const curYr = currentYear();

    let sumPrevPrev = 0;
    let sumPrev = 0;
    let sumTgt = 0;
    let sumCurYtd = 0;
    let sumTgtSamePeriod = 0;

    const latestYmCur = findLatestYm(groupMonth, curYr) ?? 0;
    const latestMonth = latestYmCur % 100;
    const samePeriodEnd = tgt * 100 + latestMonth;

    for (const r of groupMonth) {
      const yr = Math.floor(r.year_month / 100);
      if (yr === prevPrevYr) sumPrevPrev += r.sales;
      else if (yr === prevYr) sumPrev += r.sales;
      else if (yr === tgt) sumTgt += r.sales;
      if (yr === curYr && r.year_month <= latestYmCur) sumCurYtd += r.sales;
      if (yr === tgt && r.year_month >= tgt * 100 + 1 && r.year_month <= samePeriodEnd) {
        sumTgtSamePeriod += r.sales;
      }
    }

    return {
      prevYr,
      tgt,
      curYr,
      sumPrev,
      sumTgt,
      sumCurYtd,
      latestMonth,
      yoyPrev: growthPct(sumPrev, sumPrevPrev),
      yoyTgt: growthPct(sumTgt, sumPrev),
      yoyCurYtd: growthPct(sumCurYtd, sumTgtSamePeriod),
    };
  }, [groupMonth]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard
        label={`${kpis.prevYr}년 글로벌 합계`}
        value={kpis.sumPrev}
        yoy={kpis.yoyPrev}
        sub={`vs ${kpis.prevYr - 1}`}
      />
      <KpiCard
        label={`${kpis.tgt}년 글로벌 합계`}
        value={kpis.sumTgt}
        yoy={kpis.yoyTgt}
        sub={`vs ${kpis.prevYr}`}
      />
      <KpiCard
        label={`${kpis.curYr} YTD (1~${kpis.latestMonth}월)`}
        value={kpis.sumCurYtd}
        yoy={kpis.yoyCurYtd}
        sub={`vs ${kpis.tgt} 동기`}
      />
      <KpiCard
        label={`${kpis.tgt} 일평균 판매`}
        value={Math.round(kpis.sumTgt / 365)}
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
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{fmtUnits(value)}</div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-muted-foreground">{sub}</span>
        {yoy != null && (
          <span className={`text-sm font-medium tabular-nums ${arrowColor(yoy)}`}>
            {fmtChange(yoy)}
          </span>
        )}
      </div>
    </div>
  );
}
