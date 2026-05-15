'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import { useChartHeight } from '@/lib/useChartHeight';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

const ChartFallback = () => <div className="h-[260px] bg-muted/20 animate-pulse rounded" />;

const ComposedChart = dynamic(() => import('recharts').then((m) => m.ComposedChart), {
  ssr: false,
  loading: ChartFallback,
});
const Bar = dynamic(() => import('recharts').then((m) => m.Bar), { ssr: false });
const Line = dynamic(() => import('recharts').then((m) => m.Line), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then((m) => m.CartesianGrid), {
  ssr: false,
});
const Tooltip = dynamic(() => import('recharts').then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer), {
  ssr: false,
});
const ReferenceLine = dynamic(() => import('recharts').then((m) => m.ReferenceLine), {
  ssr: false,
});
const Legend = dynamic(() => import('recharts').then((m) => m.Legend), { ssr: false });

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

const PARETO_LINE = 80;

interface ParetoRow {
  name: string;
  revenue: number;
  share: number;
  cumulative: number;
}

function fmtMillion(n: number): string {
  if (Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

/**
 * 10-2. 고객 매출 집중도 (파레토).
 *
 * - 막대 = 고객별 매출 (내림차순)
 * - 라인 = 누적 매출 점유율 (%)
 * - 80% 보조선 표시
 */
export default function CustomerParetoChart({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  /** 현재 basis의 작은 reference 배열 */
  const basisEntries = annualByBasis[basis];
  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );
  const [yearLabel, setYearLabel] = useState<string>('');
  const effectiveYear = useMemo(() => {
    if (yearLabel && yearLabels.includes(yearLabel)) return yearLabel;
    return yearLabels[yearLabels.length - 1] ?? '';
  }, [yearLabel, yearLabels]);

  const chartData: ParetoRow[] = useMemo(() => {
    if (!effectiveYear) return [];
    const yearEntries = entriesForYear(basisEntries, basis, effectiveYear);
    const agg = aggregateBy(yearEntries, ['customer']);
    const total = agg.reduce((s, r) => s + r.revenue, 0);
    if (total <= 0) return [];
    const sorted = agg.filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    let cum = 0;
    return sorted.map((r) => {
      const share = (r.revenue / total) * 100;
      cum += share;
      return {
        name: r.dims.customer || '(미분류)',
        revenue: r.revenue,
        share,
        cumulative: cum,
      };
    });
  }, [basisEntries, basis, effectiveYear]);

  const h = useChartHeight(280, 360, 420);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-sm font-medium">고객 매출 집중도 (파레토)</div>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect
            label="연도"
            options={yearLabels}
            value={effectiveYear}
            onChange={setYearLabel}
          />
        </div>
      </div>
      {chartData.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 30, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10 }}
              angle={-30}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis
              yAxisId="left"
              tickFormatter={(v: number) => fmtMillion(v)}
              tick={{ fontSize: 10 }}
              width={70}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 10 }}
              width={45}
              domain={[0, 100]}
            />
            <ReferenceLine
              yAxisId="right"
              y={PARETO_LINE}
              stroke="#dc2626"
              strokeDasharray="4 3"
              label={{ value: '80%', position: 'right', fontSize: 10, fill: '#dc2626' }}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '12px',
              }}
              content={<ParetoTooltip />}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '6px 10px',
                paddingBottom: 4,
              }}
            />
            <Bar
              yAxisId="left"
              dataKey="revenue"
              name="매출"
              fill="#2563eb"
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumulative"
              name="누적 점유율"
              stroke="#dc2626"
              strokeWidth={2}
              dot={{ r: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function ParetoTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: ParetoRow }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const r = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-xs"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>매출: {fmtMillion(r.revenue)} 백만원</div>
      <div>점유율: {r.share.toFixed(1)}%</div>
      <div>누적 점유율: {r.cumulative.toFixed(1)}%</div>
    </div>
  );
}
