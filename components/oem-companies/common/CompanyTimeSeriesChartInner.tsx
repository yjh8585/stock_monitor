'use client';

import { useState } from 'react';
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
import { useChartHeight } from '@/lib/useChartHeight';
import type { CompanyTimeSeriesPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from './chartStyle';

interface Props {
  monthly: CompanyTimeSeriesPoint[];
  annual: CompanyTimeSeriesPoint[];
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
export default function CompanyTimeSeriesChartInner({ monthly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);

  const data = mode === 'year' ? annual : monthly;

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
        {mode === 'year' ? (
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
