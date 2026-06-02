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
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { UzbekistanCompanyMonthlyPoint } from '@/lib/oem-companies/uzbekistan/source';
import {
  DATA_LABEL_STYLE,
  GRID_STROKE_OPACITY,
  sumVisible,
  sumVisibleStack,
  TOTAL_LABEL_ANCHOR,
} from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  monthly: UzbekistanCompanyMonthlyPoint[];
  annual: UzbekistanCompanyMonthlyPoint[];
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

/** YoY 데이터 레이블 — null/비유한값은 빈 문자열. */
function fmtYoyLabel(v: unknown): string {
  if (v == null || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function sortByTotal(data: UzbekistanCompanyMonthlyPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.companies)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

export default function UzbekistanCompanyMonthlyChartInner({ monthly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const showLabels = mode === 'year'; // 연간 모드만 합계 라벨 + YoY 라인.
  // YoY 모드는 막대(하단)+라인(상단) 분리 공간이 필요해 차트를 키운다.
  const height = useChartHeight(
    showLabels ? 320 : 240,
    showLabels ? 360 : 280,
    showLabels ? 400 : 320
  );
  const { hidden, isHidden, legendProps } = useHiddenSeries();

  const data = mode === 'year' ? annual : monthly;

  const { companies, chartData } = useMemo(() => {
    const names = sortByTotal(data);
    const rows = data.map((d) => {
      const values = Object.fromEntries(names.map((n) => [n, d.companies[n] ?? 0]));
      const visibleCur = sumVisibleStack(values, names, hidden);
      let yoy: number | null = null;
      if (showLabels && d.prev) {
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
    return { companies: names, chartData: rows };
  }, [data, hidden, showLabels]);

  // 막대(좌축)는 하단, YoY 라인(우축)은 상단으로 분리. 토글 시 매 렌더 도메인 재계산.
  const maxTotal = Math.max(1, ...data.map((d) => d.total));
  // 막대는 plot 하단 ~43%, YoY 라인은 상단으로 분리(낮은 YoY도 막대 위에 오도록 큰 하단 패딩).
  const leftDomain: [number, number] | undefined = showLabels
    ? [0, Math.ceil(maxTotal * 2.3)]
    : undefined;
  const yoys = showLabels
    ? chartData.map((r) => r.__yoy).filter((v): v is number => v != null)
    : [];
  const yoyMax = yoys.length ? Math.max(...yoys) : 0;
  const yoyMin = yoys.length ? Math.min(...yoys) : 0;
  const yoySpan = Math.max(yoyMax - yoyMin, 10);
  const rightDomain: [number, number] = [
    Math.floor(yoyMin - yoySpan * 1.8),
    Math.ceil(yoyMax + yoySpan * 0.25),
  ];

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
          <YAxis
            yAxisId="left"
            tickFormatter={fmtUnitsTick}
            className="text-sm"
            width={60}
            domain={leftDomain}
          />
          {showLabels && (
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
          {companies.map((c, i) => {
            const isLast = i === companies.length - 1;
            return (
              <Bar
                key={c}
                yAxisId="left"
                dataKey={c}
                name={c}
                stackId="company"
                fill={OEM_COLORS[i % OEM_COLORS.length]}
                isAnimationActive={false}
                radius={isLast ? [3, 3, 0, 0] : undefined}
                hide={isHidden(c)}
              />
            );
          })}
          {showLabels && (
            <Bar
              yAxisId="left"
              dataKey="__anchor"
              stackId="company"
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
          {showLabels && (
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
    </div>
  );
}
