'use client';

import { useMemo } from 'react';
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
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { UzbekistanProductionYearPoint } from '@/lib/oem-companies/uzbekistan/source';
import {
  DATA_LABEL_STYLE,
  GRID_STROKE_OPACITY,
  sumVisible,
  sumVisibleStack,
  TOTAL_LABEL_ANCHOR,
} from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  annual: UzbekistanProductionYearPoint[];
  /** true면 stacked 대신 grouped(나란히) 막대 + 합계 라벨 숨김 — 차종별 당년/전년 비교용. */
  grouped?: boolean;
  /** true면 전년 동기 대비 YoY 꺾은선(우축, 표식·데이터레이블)을 추가. annual에 prev가 있어야 함. */
  showYoy?: boolean;
}

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

/** YoY 데이터 레이블 — null/비유한값은 빈 문자열. */
function fmtYoyLabel(v: unknown): string {
  if (v == null || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function sortBrandsByTotal(data: UzbekistanProductionYearPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.brands)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

export default function UzbekistanProductionYearChartInner({
  annual,
  grouped = false,
  showYoy = false,
}: Props) {
  // YoY 모드는 막대(하단)+라인(상단) 분리 공간이 필요해 차트를 키운다.
  const height = useChartHeight(showYoy ? 320 : 240, showYoy ? 360 : 280, showYoy ? 400 : 320);
  const { hidden, isHidden, legendProps } = useHiddenSeries();

  const { brands, chartData } = useMemo(() => {
    const names = sortBrandsByTotal(annual);
    const rows = annual.map((d) => {
      const values = Object.fromEntries(names.map((n) => [n, d.brands[n] ?? 0]));
      const visibleCur = sumVisibleStack(values, names, hidden);
      let yoy: number | null = null;
      if (showYoy && d.prev) {
        const visiblePrev = sumVisible(d.prev, names, hidden);
        yoy =
          visiblePrev > 0 && visibleCur != null
            ? ((visibleCur - visiblePrev) / visiblePrev) * 100
            : null;
      }
      return {
        period_label: d.period_label,
        total: d.total,
        ...values,
        __anchor: TOTAL_LABEL_ANCHOR,
        __labelTotal: visibleCur,
        __yoy: yoy,
      };
    });
    return { brands: names, chartData: rows };
  }, [annual, hidden, showYoy]);

  // 막대(좌축)는 하단, YoY 라인(우축)은 상단으로 분리. 토글로 값이 바뀌면 도메인도 매 렌더 재계산.
  const maxTotal = Math.max(1, ...annual.map((d) => d.total));
  // 막대는 plot 하단 ~43%, YoY 라인은 상단으로 분리(낮은 YoY도 막대 위에 오도록 큰 하단 패딩).
  const leftDomain: [number, number] | undefined = showYoy
    ? [0, Math.ceil(maxTotal * 2.3)]
    : undefined;
  const yoys = showYoy ? chartData.map((r) => r.__yoy).filter((v): v is number => v != null) : [];
  const yoyMax = yoys.length ? Math.max(...yoys) : 0;
  const yoyMin = yoys.length ? Math.min(...yoys) : 0;
  const yoySpan = Math.max(yoyMax - yoyMin, 10);
  const rightDomain: [number, number] = [
    Math.floor(yoyMin - yoySpan * 1.8),
    Math.ceil(yoyMax + yoySpan * 0.25),
  ];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 28, right: 20, bottom: 10, left: 10 }}>
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
        />
        <YAxis
          yAxisId="left"
          tickFormatter={fmtUnitsTick}
          className="text-sm"
          width={60}
          domain={leftDomain}
        />
        {showYoy && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(v) => `${v}%`}
            className="text-sm"
            width={50}
            domain={rightDomain}
          />
        )}
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '15px',
          }}
          formatter={(value, name, item) => {
            if (name === 'YoY') return [fmtYoyLabel(value) || '—', 'YoY'];
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
        {brands.map((b, i) => {
          const isLast = i === brands.length - 1;
          return (
            <Bar
              key={b}
              yAxisId="left"
              dataKey={b}
              name={b}
              stackId={grouped ? undefined : 'brand'}
              fill={OEM_COLORS[i % OEM_COLORS.length]}
              isAnimationActive={false}
              radius={grouped || isLast ? [3, 3, 0, 0] : undefined}
              hide={isHidden(b)}
            />
          );
        })}
        {!grouped && (
          <Bar
            yAxisId="left"
            dataKey="__anchor"
            stackId="brand"
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
            tooltipType="none"
          >
            <LabelList
              dataKey="__labelTotal"
              position="top"
              formatter={fmtTotalLabel}
              style={DATA_LABEL_STYLE}
            />
          </Bar>
        )}
        {showYoy && (
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="__yoy"
            name="YoY"
            stroke="#dc2626"
            strokeWidth={2}
            dot={{ r: 3, fill: '#dc2626' }}
            connectNulls
            isAnimationActive={false}
            hide={isHidden('YoY')}
          >
            <LabelList
              dataKey="__yoy"
              position="top"
              offset={10}
              formatter={fmtYoyLabel}
              style={{ fill: '#dc2626', fontSize: 12, fontWeight: 700 }}
            />
          </Line>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
