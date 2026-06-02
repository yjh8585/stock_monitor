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
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { HyundaiExportRegionPoint, HyundaiQuarterlyRegionPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  annual: HyundaiExportRegionPoint[];
  quarterly: HyundaiQuarterlyRegionPoint[];
}

type ViewMode = 'annual' | 'quarter';

/** Y축 tick — 단위에 따라 다른 포맷.
 *  - 'annual' (대): 만/M
 *  - 'quarter' (천대): 만/M (천대 기준이라 자동 환산) */
function fmtUnitsTickAnnual(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtUnitsTickQuarter(n: number): string {
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 10).toFixed(0)}만`;
  return n.toLocaleString('ko-KR');
}

/** 막대 위 합계 라벨 — 단위에 맞게 표시. 폰트 13px bold(#6). */
function fmtTotalLabelAnnual(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtTotalLabelQuarter(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return `${Math.round(n).toLocaleString('ko-KR')}`;
}

interface ChartRow {
  period_label: string;
  total: number;
  [region: string]: number | string;
}

/** annual 또는 quarterly 데이터에서 region 키와 chart 데이터를 생성.
 *  - sort: 전체 기간 합계 큰 순 (왼쪽 stack 우선) */
function buildChart(data: HyundaiExportRegionPoint[] | HyundaiQuarterlyRegionPoint[]): {
  regions: string[];
  chartData: ChartRow[];
} {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.regions)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  const regions = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  // 모든 row에 모든 region key를 0으로 초기화 + invisible marker (_marker=0) 추가.
  // marker Bar로 stack 맨 위에 LabelList를 보장 (마지막 stack Bar가 0인 row에 렌더 안 되는 문제 근본 해결).
  const chartData: ChartRow[] = data.map((d) => {
    const row: ChartRow = {
      period_label: d.period_label,
      total: d.total,
      _marker: 1,
    };
    for (const r of regions) {
      row[r] = d.regions[r] ?? 0;
    }
    return row;
  });
  return { regions, chartData };
}

/** 지역별 판매량 (IR, 도매 기준) — 연간/분기 토글 + 시리즈 hide/show + 합계 라벨. */
export default function HyundaiIRRegionsChartInner({ annual, quarterly }: Props) {
  const [mode, setMode] = useState<ViewMode>('annual');
  const height = useChartHeight(280, 320, 360);
  const { isHidden, legendProps } = useHiddenSeries();

  const isAnnual = mode === 'annual';
  const { regions, chartData } = useMemo(
    () => buildChart(isAnnual ? annual : quarterly),
    [isAnnual, annual, quarterly]
  );

  const fmtTick = isAnnual ? fmtUnitsTickAnnual : fmtUnitsTickQuarter;
  const fmtTotal = isAnnual ? fmtTotalLabelAnnual : fmtTotalLabelQuarter;
  const unitLabel = isAnnual ? '대' : '천대';

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
          aria-selected={isAnnual}
          onClick={() => setMode('annual')}
          className={`rounded-md border px-3 py-1 transition-colors ${
            isAnnual
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          연간
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={!isAnnual}
          onClick={() => setMode('quarter')}
          className={`rounded-md border px-3 py-1 transition-colors ${
            !isAnnual
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          분기
        </button>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 32, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={!isAnnual}
          />
          <XAxis
            dataKey="period_label"
            className="text-sm"
            tick={{ fontSize: 14 }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tickFormatter={fmtTick}
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
              return [
                `${v.toLocaleString('ko-KR')}${unitLabel} (${pct.toFixed(1)}%)`,
                String(name),
              ];
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
          {/* invisible Line dataKey=total → stack 맨 위 좌표에 점 → LabelList position=top이 정확히 stack 위. */}
          <Line
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
              formatter={fmtTotal}
              style={DATA_LABEL_STYLE}
            />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
