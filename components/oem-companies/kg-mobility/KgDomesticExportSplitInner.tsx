'use client';

import { useState } from 'react';
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
import { useChartHeight } from '@/lib/useChartHeight';
import type { KgRegionSeriesPoint } from '@/lib/oem-companies/kg-mobility/aggregate';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  monthly: KgRegionSeriesPoint[];
  annual: KgRegionSeriesPoint[];
}

type ViewMode = 'year' | 'month';

/** 판매량 단위(만/M) 자동 변환. */
function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 막대 위 합계 라벨 — 만/M 자동 (#6 13px bold). */
function fmtTotalLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 내수/수출 stacked bar — 합계 line 제거, Tooltip에 비중(%) 표시.
 *  Legend 클릭으로 시리즈 hide/show 토글 (#1). */
export default function KgDomesticExportSplitInner({ monthly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

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
        <BarChart data={data} margin={{ top: 28, right: 20, bottom: 10, left: 10 }}>
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
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '16px',
            }}
            formatter={(value, name, item) => {
              const v = Number(value ?? 0);
              const total = (item?.payload as KgRegionSeriesPoint | undefined)?.total ?? 0;
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
          <Bar
            dataKey="domestic"
            name="내수"
            stackId="region"
            fill="#2563eb"
            isAnimationActive={false}
            hide={isHidden('domestic')}
          />
          <Bar
            dataKey="export"
            name="수출"
            stackId="region"
            fill="#f59e0b"
            isAnimationActive={false}
            radius={[3, 3, 0, 0]}
            hide={isHidden('export')}
          >
            <LabelList
              dataKey="total"
              position="top"
              formatter={fmtTotalLabel}
              style={DATA_LABEL_STYLE}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
