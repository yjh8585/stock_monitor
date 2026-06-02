'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { useChartHeight } from '@/lib/useChartHeight';
import type { StellantisNaBrandStackPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';
import {
  STELLANTIS_NA_BRAND_COLORS,
  sortBrandsByTotal,
} from '@/lib/oem-companies/stellantis-na/aggregate';

interface Props {
  quarterly: StellantisNaBrandStackPoint[];
  annual: StellantisNaBrandStackPoint[];
}

type ViewMode = 'year' | 'quarter';

/** 판매량 단위 라벨 (만/M). */
function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 막대 위 합계 라벨 (15px bold). */
function fmtTotalLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** Stellantis NA brand stacked bar — 분기/연 토글, 합계 라벨, brand 6종 hide/show. */
export default function StellantisNaQuarterlySeriesChartInner({ quarterly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = mode === 'year' ? annual : quarterly;

  const { brands, chartData } = useMemo(() => {
    const sorted = sortBrandsByTotal(data);
    const rows = data.map((d) => ({
      period_label: d.period_label,
      total: d.total,
      ...d.brands,
    }));
    return { brands: sorted, chartData: rows };
  }, [data]);

  return (
    <div>
      <div
        role="tablist"
        aria-label="기간 단위 선택"
        className="mb-3 flex items-center gap-2 text-sm"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'year'}
          onClick={() => setMode('year')}
          className={`rounded-md border px-3 py-1 transition-colors ${
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
          aria-selected={mode === 'quarter'}
          onClick={() => setMode('quarter')}
          className={`rounded-md border px-3 py-1 transition-colors ${
            mode === 'quarter'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          분기
        </button>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 28, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={false}
          />
          <XAxis
            dataKey="period_label"
            className="text-sm"
            tick={{ fontSize: 14 }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
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
              const v = Number(value ?? 0);
              const total = Number((item?.payload as { total?: number } | undefined)?.total ?? 0);
              const pct = total > 0 ? (v / total) * 100 : 0;
              return [`${v.toLocaleString('ko-KR')}대 (${pct.toFixed(1)}%)`, String(name)];
            }}
            itemSorter={(item) => -(item.value as number)}
          />
          <Legend
            layout="horizontal"
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '16px', paddingBottom: 8 }}
            itemSorter={null}
            {...legendProps}
          />
          {brands.map((b, i) => {
            const isLast = i === brands.length - 1;
            return (
              <Bar
                key={b}
                dataKey={b}
                name={b}
                stackId="brand"
                fill={STELLANTIS_NA_BRAND_COLORS[b] ?? '#94a3b8'}
                isAnimationActive={false}
                radius={isLast ? [3, 3, 0, 0] : undefined}
                hide={isHidden(b)}
              >
                {isLast && (
                  <LabelList
                    dataKey="total"
                    position="top"
                    formatter={fmtTotalLabel}
                    style={DATA_LABEL_STYLE}
                  />
                )}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
