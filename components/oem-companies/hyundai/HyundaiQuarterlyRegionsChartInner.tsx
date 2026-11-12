'use client';

import { useMemo } from 'react';
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
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { HyundaiQuarterlyRegionPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

/** 값 단위 — label 은 툴팁 꼬리, tick 'thousand_units' = 천대 값을 만/M 로 접는 축(기본) · 'plain' = 숫자 그대로. */
export interface RegionsChartUnit {
  label: string;
  tick: 'thousand_units' | 'plain';
}

const DEFAULT_UNIT: RegionsChartUnit = { label: '천대', tick: 'thousand_units' };

interface Props {
  data: HyundaiQuarterlyRegionPoint[];
  unit?: RegionsChartUnit;
}

/** Y축 tick — 천대(k) → 만/M 자동 변환. */
function fmtUnitsTick(n: number): string {
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 10).toFixed(0)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtPlainTick(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

/** 막대 위 합계 라벨 — value는 천대 단위. */
function fmtTotalLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return `${Math.round(n).toLocaleString('ko-KR')}`;
}

/** 전 기간 합계 큰 region 순으로 정렬 — stack 아래/legend 왼쪽 일관성. */
function sortRegionsByTotal(data: HyundaiQuarterlyRegionPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.regions)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** 분기별 region stacked bar (기본 천대). 막대 위 합계 라벨 + 합계 큰 region 우선 stack.
 *  Legend 클릭으로 시리즈 hide/show 토글 (#1). */
export default function HyundaiQuarterlyRegionsChartInner({ data, unit = DEFAULT_UNIT }: Props) {
  const height = useChartHeight(280, 320, 360);
  const { isHidden, legendProps } = useHiddenSeries();

  const { regions, chartData, yoyByLabel } = useMemo(() => {
    const names = sortRegionsByTotal(data);
    const rows = data.map((d) => ({
      period_label: d.period_label,
      total: d.total,
      ...d.regions,
    }));
    // 전년 동기 대비(있는 점만) — 툴팁이 기간 이름으로 찾는다(계열 이름과 섞이지 않게 행 밖에 둔다).
    const yoy = new Map(data.filter((d) => d.yoy).map((d) => [d.period_label, d]));
    return { regions: names, chartData: rows, yoyByLabel: yoy };
  }, [data]);
  const fmtYoy = (v: number | null | undefined) =>
    v == null ? '' : ` · YoY ${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 24, right: 20, bottom: 10, left: 10 }}>
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
        <YAxis
          tickFormatter={unit.tick === 'thousand_units' ? fmtUnitsTick : fmtPlainTick}
          className="text-sm"
          width={60}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={TOOLTIP_CONTENT_STYLE}
          formatter={(value, name, item) => {
            const v = Number(value ?? 0);
            const p = item?.payload as { total?: number; period_label?: string } | undefined;
            const total = Number(p?.total ?? 0);
            const pct = total > 0 ? (v / total) * 100 : 0;
            const yoy = yoyByLabel.get(p?.period_label ?? '')?.yoy?.regions[String(name)];
            return [
              `${v.toLocaleString('ko-KR')}${unit.label} (${pct.toFixed(1)}%)${fmtYoy(yoy)}`,
              String(name),
            ];
          }}
          labelFormatter={(label) => {
            // YoY 가 있는 차트만 머리에 합계·비교 기간을 붙인다(현대차 OEM 탭은 그대로).
            const d = yoyByLabel.get(String(label));
            if (!d?.yoy) return String(label);
            return `${label} · 합계 ${d.total.toLocaleString('ko-KR')}${unit.label}${fmtYoy(d.yoy.total)} (${d.yoy.label} 대비)`;
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
            >
              {/* 마지막 stack에만 합계 LabelList — 분기별 총합을 막대 위에 표시 (#6 13px bold). */}
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
  );
}
