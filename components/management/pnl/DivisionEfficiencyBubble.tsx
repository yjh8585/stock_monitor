'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import { useChartHeight } from '@/lib/useChartHeight';
import { aggregateBy, entriesForYear, getDisplayYearLabels, opMarginOf } from '@/lib/pnl/aggregate';
import type { Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';
import { OEM_COLORS } from '@/components/oem/helpers';

const ChartFallback = () => <div className="h-[260px] bg-muted/20 animate-pulse rounded" />;

const ScatterChart = dynamic(() => import('recharts').then((m) => m.ScatterChart), {
  ssr: false,
  loading: ChartFallback,
});
const Scatter = dynamic(() => import('recharts').then((m) => m.Scatter), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });
const ZAxis = dynamic(() => import('recharts').then((m) => m.ZAxis), { ssr: false });
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

interface BubblePoint {
  division: string;
  revenueYoy: number;
  margin: number;
  revenue: number;
  color: string;
}

function fmtMillion(n: number): string {
  if (Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

/**
 * 10-3. 부문별 효율 매트릭스 (버블).
 *
 * - X = 매출 YoY%
 * - Y = 영업이익률 (%)
 * - 점 크기 = 매출 규모
 * - 색 = 부문
 */
export default function DivisionEfficiencyBubble({ annualByBasis }: Props) {
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

  // 전년 라벨 (직전 연도) — yearLabels에 존재해야 YoY 계산 가능
  const prevLabel = useMemo(() => {
    const idx = yearLabels.indexOf(effectiveYear);
    if (idx <= 0) return '';
    return yearLabels[idx - 1];
  }, [yearLabels, effectiveYear]);

  const points: BubblePoint[] = useMemo(() => {
    if (!effectiveYear) return [];
    const baseEntries = entriesForYear(basisEntries, basis, effectiveYear);
    const baseAgg = aggregateBy(baseEntries, ['division']);
    const prevAgg = prevLabel
      ? aggregateBy(entriesForYear(basisEntries, basis, prevLabel), ['division'])
      : [];
    const prevMap = new Map<string, number>();
    for (const r of prevAgg) prevMap.set(r.dims.division, r.revenue);

    return baseAgg
      .filter((r) => r.revenue > 0)
      .map((r, i) => {
        const prevRev = prevMap.get(r.dims.division) ?? 0;
        const yoy = prevRev > 0 ? ((r.revenue - prevRev) / prevRev) * 100 : 0;
        return {
          division: r.dims.division || '(미분류)',
          revenueYoy: yoy,
          margin: opMarginOf(r) ?? 0,
          revenue: r.revenue,
          color: OEM_COLORS[i % OEM_COLORS.length],
        };
      });
  }, [basisEntries, basis, effectiveYear, prevLabel]);

  const h = useChartHeight(280, 360, 420);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-sm font-medium">부문별 효율 매트릭스</div>
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
      <div className="text-[10px] text-muted-foreground mb-2">
        X=매출 YoY% · Y=영업이익률 · 크기=매출 규모 · 색=부문
        {!prevLabel && ' · 전년 데이터 없음(YoY=0)'}
      </div>
      {points.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              dataKey="revenueYoy"
              name="매출 YoY"
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 11 }}
              label={{
                value: '매출 YoY (%)',
                position: 'insideBottom',
                offset: -15,
                style: { fontSize: 11, fill: 'var(--muted-foreground)' },
              }}
            />
            <YAxis
              type="number"
              dataKey="margin"
              name="영업이익률"
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 11 }}
              label={{
                value: '영업이익률 (%)',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 11, fill: 'var(--muted-foreground)' },
              }}
            />
            <ZAxis type="number" dataKey="revenue" range={[60, 600]} name="매출" />
            <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '12px',
              }}
              content={<BubbleTooltip />}
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
            {points.map((p) => (
              <Scatter key={p.division} name={p.division} data={[p]} fill={p.color} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function BubbleTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: BubblePoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-xs"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="font-semibold mb-1">{p.division}</div>
      <div>매출: {fmtMillion(p.revenue)} 백만원</div>
      <div>매출 YoY: {p.revenueYoy.toFixed(1)}%</div>
      <div className={p.margin < 0 ? 'text-red-500' : ''}>영업이익률: {p.margin.toFixed(1)}%</div>
    </div>
  );
}
