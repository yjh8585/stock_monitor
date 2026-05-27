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
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { HyundaiExportRegionPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  monthly: HyundaiExportRegionPoint[];
  annual: HyundaiExportRegionPoint[];
  /** 막대 끝 합계 데이터 레이블 표시 여부 (사용자 요청 #6 — 9-region 차트에 사용). */
  showTotalLabels?: boolean;
  /** 월간 모드에서는 라벨 숨김 (사용자 요청 — 가독성). */
  hideLabelsOnMonth?: boolean;
}

type ViewMode = 'year' | 'month';

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 막대 위 합계 라벨용 — 큰 수는 만/M 자동. recharts LabelList의 formatter는 RenderableText 받음. */
function fmtTotalLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function sortRegionsByTotal(data: HyundaiExportRegionPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.regions)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

export default function HyundaiExportRegionChartInner({
  monthly,
  annual,
  showTotalLabels = false,
  hideLabelsOnMonth = false,
}: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const effectiveShowLabels = showTotalLabels && !(hideLabelsOnMonth && mode === 'month');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = mode === 'year' ? annual : monthly;

  const { regions, chartData } = useMemo(() => {
    const names = sortRegionsByTotal(data);
    const rows = data.map((d) => {
      const row: Record<string, string | number | boolean> = {
        period_label: d.period_label,
        total: d.total,
        is_ytd: d.is_ytd ?? false,
        _marker: 1,
      };
      for (const r of names) {
        row[r] = d.regions[r] ?? 0;
      }
      return row;
    });
    return { regions: names, chartData: rows };
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
          aria-selected={mode === 'month'}
          onClick={() => setMode('month')}
          className={`rounded-md border px-3 py-1 transition-colors ${
            mode === 'month'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          월간
        </button>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          margin={{ top: showTotalLabels ? 32 : 10, right: 20, bottom: 10, left: 10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={mode === 'month'}
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
            domain={showTotalLabels ? Y_AXIS_PADDED_DOMAIN : undefined}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '16px',
            }}
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
          {regions.map((r, i) => {
            const isLast = i === regions.length - 1;
            return (
              <Bar
                key={r}
                dataKey={r}
                name={r}
                stackId="region"
                fill={OEM_COLORS[i % OEM_COLORS.length]}
                isAnimationActive={false}
                radius={isLast ? [3, 3, 0, 0] : undefined}
                hide={isHidden(r)}
              />
            );
          })}
          {/* invisible marker Bar — 항상 모든 row에 0으로 존재, stack 맨 위에 LabelList 보장 */}
          {effectiveShowLabels && (
            <Bar
              dataKey="_marker"
              stackId="region"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
            >
              <LabelList
                dataKey="total"
                position="top"
                formatter={fmtTotalLabel}
                style={DATA_LABEL_STYLE}
              />
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
