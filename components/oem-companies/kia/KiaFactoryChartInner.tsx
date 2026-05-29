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
import type { FactoryMixPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  monthly: FactoryMixPoint[];
  annual: FactoryMixPoint[];
  /** 월간 모드에서 합계 라벨 숨김 — 가독성. */
  hideLabelsOnMonth?: boolean;
}

type ViewMode = 'year' | 'month';

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

/** Kia 공장 코드(엑셀 표기) → 위치. 한국(국내) + 해외 5곳. */
const KIA_FACTORY_LOCATIONS: Record<string, string> = {
  'Korea Plants': '한국 (광주·소하리·화성, 내수+수출)',
  'U.S. Plant': '미국 조지아 (West Point)',
  'China Plants': '중국 (옌청·DYK)',
  'Slovakia Plant': '슬로바키아 질리나',
  'Mexico Plant': '멕시코 누에보레온 (Pesquería)',
  'India Plant': '인도 아난타푸르',
};

/** 전체 기간 합계 큰 순으로 factory 정렬 — 색상·stack 순서 안정화. */
function sortFactoriesByTotal(data: FactoryMixPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.factories)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** Kia 해외 공장별 stacked bar — 합계 line 없음. Tooltip에 비중(%) 표시.
 *  Legend 클릭으로 시리즈 hide/show 토글 (#1). */
export default function KiaFactoryChartInner({ monthly, annual, hideLabelsOnMonth = true }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = mode === 'year' ? annual : monthly;
  const showTotalLabels = !(hideLabelsOnMonth && mode === 'month');

  const { factories, chartData } = useMemo(() => {
    const names = sortFactoriesByTotal(data);
    const rows = data.map((d) => ({
      period_label: d.period_label,
      total: d.total,
      ...Object.fromEntries(names.map((n) => [n, d.factories[n] ?? 0])),
    }));
    return { factories: names, chartData: rows };
  }, [data]);

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
        <ComposedChart
          data={chartData}
          margin={{ top: showTotalLabels ? 28 : 10, right: 20, bottom: 10, left: 10 }}
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
            wrapperStyle={{ fontSize: '16px', paddingBottom: 24 }}
            itemSorter={null}
            {...legendProps}
          />
          {factories.map((f, i) => {
            const isLast = i === factories.length - 1;
            return (
              <Bar
                key={f}
                dataKey={f}
                name={f}
                stackId="factory"
                fill={OEM_COLORS[i % OEM_COLORS.length]}
                isAnimationActive={false}
                radius={isLast ? [3, 3, 0, 0] : undefined}
                hide={isHidden(f)}
              />
            );
          })}
          {/* invisible Line — stack 맨 위(total) 좌표에 합계 라벨을 정확히 배치. */}
          {showTotalLabels && (
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

      <div className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium">공장 위치:</span>{' '}
        {factories
          .map((f) => {
            const loc = KIA_FACTORY_LOCATIONS[f] ?? '미상';
            return (
              <span key={f}>
                <span className="font-medium text-foreground">{f}</span>={loc}
              </span>
            );
          })
          .reduce<React.ReactNode[]>((acc, node, i) => {
            if (i > 0) acc.push(<span key={`sep-${i}`}> · </span>);
            acc.push(node);
            return acc;
          }, [])}
      </div>
    </div>
  );
}
