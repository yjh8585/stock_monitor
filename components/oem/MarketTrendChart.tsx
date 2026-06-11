'use client';

import { useMemo, useState } from 'react';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { arrowColor, fmtChange, growthPct } from '@/lib/format';
import type { OemSalesGroupMonth } from '@/lib/types';
import {
  DATA_LABEL_STYLE,
  GRID_STROKE_OPACITY,
} from '@/components/oem-companies/common/chartStyle';
import { findLatestYm, fmtFull, fmtUnits, totalByMonth, ymLabel, ymYear } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

type ViewMode = 'year' | 'month';

/** Tooltip: "판매량  1,234,567 대 · YoY ▲5.3%" (전년 동월/동년 대비, YTD 연도는 YoY 생략) */
function renderSalesTooltip(value: unknown, _name: unknown, item: unknown) {
  const yoy = (item as { payload?: { yoy?: number | null } })?.payload?.yoy ?? null;
  return [
    <span key="sales">
      {fmtFull(Number(value))} 대
      {yoy != null && <span className={arrowColor(yoy)}>{` · YoY ${fmtChange(yoy)}`}</span>}
    </span>,
    '판매량',
  ];
}

/** 글로벌 시장 추이 — 연/월 토글 (기본 연간) */
export default function MarketTrendChart({ groupMonth }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const h = useChartHeight(200, 240, 280);

  const monthData = useMemo(() => {
    const totals = totalByMonth(groupMonth);
    const salesByYm = new Map(totals.map((d) => [d.ym, d.sales]));
    return totals.map((d) => {
      const prev = salesByYm.get(d.ym - 100); // 전년 동월 (YYYYMM - 100)
      return {
        ym: d.ym,
        label: ymLabel(d.ym),
        sales: d.sales,
        yoy: prev != null ? growthPct(d.sales, prev) : null,
      };
    });
  }, [groupMonth]);

  const yearData = useMemo(() => {
    // 전체 시장 = annualByGroup의 모든 그룹 합계
    const yearMap = new Map<number, number>();
    for (const r of groupMonth) {
      const y = ymYear(r.year_month);
      yearMap.set(y, (yearMap.get(y) ?? 0) + r.sales);
    }
    const years = [...yearMap.keys()].sort((a, b) => a - b);
    const maxYear = years.length ? years[years.length - 1] : 0;
    // 마지막 연도가 12월 미만(YTD)이면 전년 전체와 비교 시 왜곡 → 해당 연도 YoY 생략
    const latestYm = findLatestYm(groupMonth, maxYear);
    const maxYearIsYtd = latestYm != null && latestYm % 100 < 12;
    return years.map((y) => {
      const sales = yearMap.get(y)!;
      const isYtd = y === maxYear && maxYearIsYtd;
      return {
        year: String(y),
        sales,
        yoy: isYtd ? null : growthPct(sales, yearMap.get(y - 1) ?? null),
      };
    });
  }, [groupMonth]);

  // 2026년은 YTD라 비교 어려움 → 캡션 안내
  const has2026 = yearData.some((d) => d.year === '2026');

  return (
    <div>
      <div
        role="tablist"
        aria-label="기간 단위 선택"
        className="flex items-center gap-2 mb-3 text-sm"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'year'}
          onClick={() => setMode('year')}
          className={`px-3 py-1 rounded-md border transition-colors ${
            mode === 'year'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          연간
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'month'}
          onClick={() => setMode('month')}
          className={`px-3 py-1 rounded-md border transition-colors ${
            mode === 'month'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          월간
        </button>
        {mode === 'year' && has2026 && (
          <span className="text-[10px] text-muted-foreground ml-2">
            2026년은 YTD 누적 (연간 환산 아님)
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={h}>
        {mode === 'year' ? (
          <BarChart data={yearData} margin={{ top: 28, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={GRID_STROKE_OPACITY}
              vertical={false}
            />
            <XAxis dataKey="year" className="text-sm" />
            <YAxis tickFormatter={(v) => fmtUnits(v)} className="text-sm" width={60} />
            <Tooltip
              formatter={renderSalesTooltip}
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
            />
            <Bar dataKey="sales" fill="#2563eb" radius={[3, 3, 0, 0]}>
              <LabelList
                dataKey="sales"
                position="top"
                formatter={(v: unknown) => (v == null ? '' : fmtUnits(Number(v)))}
                style={DATA_LABEL_STYLE}
              />
            </Bar>
          </BarChart>
        ) : (
          <AreaChart data={monthData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <defs>
              <linearGradient id="marketTrendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={GRID_STROKE_OPACITY}
            />
            <XAxis dataKey="label" className="text-sm" tick={{ fontSize: 14 }} interval={5} />
            <YAxis tickFormatter={(v) => fmtUnits(v)} className="text-sm" width={60} />
            <Tooltip formatter={renderSalesTooltip} contentStyle={TOOLTIP_CONTENT_STYLE} />
            <Area
              type="monotone"
              dataKey="sales"
              stroke="#2563eb"
              strokeWidth={2}
              fill="url(#marketTrendGrad)"
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
