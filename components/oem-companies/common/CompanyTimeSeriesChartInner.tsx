'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { OEM_COLORS } from '@/components/charts/palette';
import { useChartHeight } from '@/lib/useChartHeight';
import type { CompanyTimeSeriesPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from './chartStyle';

/** 비교용 두 번째 계열(회사 발표 물량 등) — `period`('YYYY-MM' · 'YYYY')로 기본 계열 점에 붙인다. */
export interface TimeSeriesSecondary {
  /** 범례·툴팁 이름. */
  label: string;
  /** 두 번째 계열이 있을 때 기본 계열의 범례·툴팁 이름(없으면 「출하량」). */
  primaryLabel?: string;
  monthly?: { period: string; value: number }[];
  annual?: { period: string; value: number }[];
}

interface Props {
  monthly: CompanyTimeSeriesPoint[];
  annual: CompanyTimeSeriesPoint[];
  /** 없으면(기본) 지금 동작 그대로 — 지금 보는 단위에 값이 있을 때만 선 하나·범례를 더 그린다. */
  secondary?: TimeSeriesSecondary;
}

type ViewMode = 'year' | 'month';

/** 판매량 단위 라벨 (만/M 자동 변환). */
function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 천 단위 콤마 (Tooltip 정확 표기). */
function fmtFull(n: number): string {
  return n.toLocaleString('ko-KR');
}

/** 막대 위 데이터 라벨 — 큰 수는 만/M 자동 (#6). */
function fmtBarLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** YoY % 라벨 (Tooltip 보조). */
function fmtYoy(value: unknown): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(1)}%`;
}

/**
 * 시계열 차트 — 연/월 토글.
 * 연간: BarChart (oem MarketTrendChart 패턴)
 * 월간: AreaChart with gradient
 */
export default function CompanyTimeSeriesChartInner({ monthly, annual, secondary }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);

  const data = mode === 'year' ? annual : monthly;
  const secondaryPoints = mode === 'year' ? secondary?.annual : secondary?.monthly;
  const secondaryByPeriod = new Map((secondaryPoints ?? []).map((p) => [p.period, p.value]));
  // 기본 계열 기간에 겹치는 값이 하나도 없으면 두 번째 계열을 그리지 않는다(빈 범례 방지).
  const merged =
    secondary && data.some((p) => secondaryByPeriod.has(p.period))
      ? data.map((p) => ({ ...p, secondary: secondaryByPeriod.get(p.period) ?? null }))
      : null;
  const primaryLabel = secondary?.primaryLabel ?? '출하량';

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
      </div>

      <ResponsiveContainer width="100%" height={height}>
        {merged && secondary ? (
          // 두 번째 계열이 있을 때만 — 같은 단위(대)라 한 Y축에 함께 그린다(이중 축 아님 → §4-F 밴드 분리 대상 아님).
          <ComposedChart
            data={merged}
            margin={{ top: mode === 'year' ? 32 : 10, right: 20, bottom: 10, left: 10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={GRID_STROKE_OPACITY}
              vertical={mode !== 'year'}
            />
            <XAxis
              dataKey="period_label"
              className="text-sm"
              tick={{ fontSize: 14 }}
              {...(mode === 'month'
                ? { interval: 'preserveStartEnd' as const, minTickGap: 20 }
                : {})}
            />
            <YAxis
              tickFormatter={fmtUnitsTick}
              className="text-sm"
              width={60}
              {...(mode === 'year' ? { domain: Y_AXIS_PADDED_DOMAIN } : {})}
            />
            <Tooltip
              cursor={mode === 'year' ? { fill: 'var(--muted)' } : undefined}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              formatter={(value, name, item) => {
                if (value == null) return ['—', String(name)];
                if (name === secondary.label)
                  return [`${fmtFull(Number(value))}대`, secondary.label];
                const yoy = (item?.payload as CompanyTimeSeriesPoint | undefined)?.yoy_pct;
                const yoyText = yoy == null ? '' : ` (YoY ${fmtYoy(yoy)})`;
                return [`${fmtFull(Number(value))}대${yoyText}`, primaryLabel];
              }}
            />
            <Legend
              layout="horizontal"
              verticalAlign="top"
              align="center"
              wrapperStyle={{ fontSize: '16px', paddingBottom: 8 }}
            />
            {mode === 'year' ? (
              <Bar dataKey="sales" name={primaryLabel} fill="#2563eb" radius={[3, 3, 0, 0]}>
                <LabelList
                  dataKey="sales"
                  position="top"
                  formatter={fmtBarLabel}
                  style={DATA_LABEL_STYLE}
                />
              </Bar>
            ) : (
              <Area
                type="monotone"
                dataKey="sales"
                name={primaryLabel}
                stroke="#2563eb"
                strokeWidth={2}
                fill="#2563eb"
                fillOpacity={0.1}
              />
            )}
            <Line
              type="monotone"
              dataKey="secondary"
              name={secondary.label}
              stroke={OEM_COLORS[3]}
              strokeWidth={2}
              dot={mode === 'year'}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          </ComposedChart>
        ) : mode === 'year' ? (
          <BarChart data={data} margin={{ top: 32, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={GRID_STROKE_OPACITY}
              vertical={false}
            />
            <XAxis dataKey="period_label" className="text-sm" tick={{ fontSize: 14 }} />
            <YAxis
              tickFormatter={fmtUnitsTick}
              className="text-sm"
              width={60}
              domain={Y_AXIS_PADDED_DOMAIN}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              formatter={(value, name, item) => {
                const label = String(name);
                if (label === 'YoY') return [fmtYoy(value), label];
                const yoy = (item?.payload as CompanyTimeSeriesPoint | undefined)?.yoy_pct;
                const yoyText = yoy == null ? '' : ` (YoY ${fmtYoy(yoy)})`;
                return [`${fmtFull(Number(value))}대${yoyText}`, '출하량'];
              }}
            />
            <Bar dataKey="sales" name="출하량" fill="#2563eb" radius={[3, 3, 0, 0]}>
              <LabelList
                dataKey="sales"
                position="top"
                formatter={fmtBarLabel}
                style={DATA_LABEL_STYLE}
              />
            </Bar>
          </BarChart>
        ) : (
          <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <defs>
              <linearGradient id="companyTimeSeriesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={GRID_STROKE_OPACITY}
            />
            <XAxis
              dataKey="period_label"
              className="text-sm"
              tick={{ fontSize: 14 }}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis tickFormatter={fmtUnitsTick} className="text-sm" width={60} />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              formatter={(value, _name, item) => {
                const yoy = (item?.payload as CompanyTimeSeriesPoint | undefined)?.yoy_pct;
                const yoyText = yoy == null ? '' : ` (YoY ${fmtYoy(yoy)})`;
                return [`${fmtFull(Number(value))}대${yoyText}`, '출하량'];
              }}
            />
            <Area
              type="monotone"
              dataKey="sales"
              name="출하량"
              stroke="#2563eb"
              strokeWidth={2}
              fill="url(#companyTimeSeriesGrad)"
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
