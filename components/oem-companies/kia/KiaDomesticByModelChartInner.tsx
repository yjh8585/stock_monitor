'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
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
import { TOOLTIP_CONTENT_STYLE_SM } from '@/components/charts/chartTheme';
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { KiaDomesticByModelPoint } from '@/lib/oem-companies/kia/aggregate';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  monthly: KiaDomesticByModelPoint[];
  annual: KiaDomesticByModelPoint[];
  hideLabelsOnMonth?: boolean;
}

type ViewMode = 'year' | 'month';

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtTotalLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 전 기간 합계 큰 순으로 모델 정렬. */
function sortModelsByTotal(data: KiaDomesticByModelPoint[], topN = 12): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.models)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([n]) => n);
}

export default function KiaDomesticByModelChartInner({
  monthly,
  annual,
  hideLabelsOnMonth = true,
}: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(280, 320, 380);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = mode === 'year' ? annual : monthly;
  const showLabels = !(hideLabelsOnMonth && mode === 'month');

  const { models, chartData } = useMemo(() => {
    const names = sortModelsByTotal(data, 12);
    const rows = data.map((d) => {
      // models 정렬에 포함되지 않은 나머지 → 'Others' 합산
      let othersSum = 0;
      for (const [name, v] of Object.entries(d.models)) {
        if (!names.includes(name)) othersSum += v;
      }
      const base = Object.fromEntries(names.map((n) => [n, d.models[n] ?? 0]));
      return {
        period_label: d.period_label,
        total: d.total,
        ...base,
        Others: othersSum,
      };
    });
    const finalNames = [...names];
    if (rows.some((r) => (r.Others as number) > 0)) finalNames.push('Others');
    return { models: finalNames, chartData: rows };
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
        <ComposedChart
          data={chartData}
          margin={{ top: showLabels ? 28 : 10, right: 20, bottom: 10, left: 10 }}
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
          <YAxis tickFormatter={fmtUnitsTick} className="text-sm" width={60} />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={TOOLTIP_CONTENT_STYLE_SM}
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
            wrapperStyle={{ fontSize: '14px', paddingBottom: 16 }}
            itemSorter={null}
            {...legendProps}
          />
          {models.map((m, i) => {
            const isLast = i === models.length - 1;
            return (
              <Bar
                key={m}
                dataKey={m}
                name={m}
                stackId="model"
                fill={OEM_COLORS[i % OEM_COLORS.length]}
                isAnimationActive={false}
                radius={isLast ? [3, 3, 0, 0] : undefined}
                hide={isHidden(m)}
              />
            );
          })}
          {showLabels && (
            <Line
              type="linear"
              dataKey="total"
              stroke="transparent"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              legendType="none"
            >
              <LabelList
                dataKey="total"
                position="top"
                formatter={fmtTotalLabel}
                style={DATA_LABEL_STYLE}
              />
            </Line>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
