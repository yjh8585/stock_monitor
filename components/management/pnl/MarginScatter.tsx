'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import { useChartHeight } from '@/lib/useChartHeight';
import { aggregateBy, entriesForYear, getDisplayYearLabels, opMarginOf } from '@/lib/pnl/aggregate';
import type { Basis, DimensionKey, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';
import { OEM_COLORS } from '@/components/oem/helpers';

const ChartFallback = () => (
  <div className="h-[260px] md:h-[360px] bg-muted/20 animate-pulse rounded" />
);

// 동적 import (recharts 클라이언트 번들 분리)
const ScatterChart = dynamic(() => import('recharts').then((m) => m.ScatterChart), {
  ssr: false,
  loading: ChartFallback,
});
const Scatter = dynamic(() => import('recharts').then((m) => m.Scatter), { ssr: false });
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

type DimChoice = 'customer' | 'product' | 'division';

const DIM_OPTIONS: { value: DimChoice; label: string; key: DimensionKey }[] = [
  { value: 'customer', label: '고객', key: 'customer' },
  { value: 'product', label: '제품', key: 'product' },
  { value: 'division', label: '부문', key: 'division' },
];

interface ScatterPoint {
  name: string;
  revenue: number;
  margin: number;
  opIncome: number;
}

/** 백만원 천 단위 콤마. null/0/NaN은 '—' */
function fmtMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n === 0) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

/**
 * 추가 2: 분산형 차트 (매출 × 영업이익률).
 *
 * - X = 매출 (백만원)
 * - Y = 영업이익률 (%)
 * - 점 = 선택된 차원의 unique 값 (고객/제품/부문)
 *
 * 성능: basis 토글 시 `annualByBasis[basis]` 작은 배열만 사용.
 */
export default function MarginScatter({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const [dim, setDim] = useState<DimChoice>('customer');

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

  const dimConfig = useMemo(
    () => DIM_OPTIONS.find((d) => d.value === dim) ?? DIM_OPTIONS[0],
    [dim]
  );

  const points: ScatterPoint[] = useMemo(() => {
    if (!effectiveYear) return [];
    const yearEntries = entriesForYear(basisEntries, basis, effectiveYear);
    const aggregated = aggregateBy(yearEntries, [dimConfig.key]);
    return aggregated
      .filter((r) => r.revenue > 0)
      .map((r) => ({
        name: r.dims[dimConfig.key] || '(미분류)',
        revenue: r.revenue,
        margin: opMarginOf(r) ?? 0,
        opIncome: r.op_income,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [basisEntries, basis, effectiveYear, dimConfig.key]);

  const h = useChartHeight(280, 380, 460);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-base font-semibold">추가 2. 매출 × 영업이익률 분산</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect
            label="연도"
            options={yearLabels}
            value={effectiveYear}
            onChange={setYearLabel}
          />
          <DimRadio value={dim} onChange={setDim} />
        </div>
      </header>
      {points.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          선택한 조건에 해당하는 데이터가 없습니다.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              dataKey="revenue"
              name="매출"
              tickFormatter={(v: number) => fmtMillion(v)}
              tick={{ fontSize: 11 }}
              label={{
                value: '매출 (백만원)',
                position: 'insideBottom',
                offset: -10,
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
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '12px',
              }}
              content={<ScatterTooltip />}
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
            <Scatter name={dimConfig.label} data={points} fill={OEM_COLORS[0]} shape="circle" />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

/** 호버 툴팁 — 라벨 + 매출 + 영업이익률 + 영업이익 */
function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScatterPoint }>;
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
      <div className="font-semibold mb-1">{p.name}</div>
      <div>매출: {fmtMillion(p.revenue)} 백만원</div>
      <div>영업이익률: {p.margin.toFixed(1)}%</div>
      <div className={p.opIncome < 0 ? 'text-red-500' : ''}>
        영업이익: {fmtMillion(p.opIncome)} 백만원
      </div>
    </div>
  );
}

/** 차원 선택 라디오 (고객/제품/부문) */
function DimRadio({ value, onChange }: { value: DimChoice; onChange: (v: DimChoice) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
      {DIM_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`text-xs px-2.5 py-1 rounded-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
