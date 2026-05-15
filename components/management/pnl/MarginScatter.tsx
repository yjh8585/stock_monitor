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
  <div className="h-[280px] md:h-[380px] bg-muted/20 animate-pulse rounded" />
);

// 동적 import (recharts 클라이언트 번들 분리)
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

type DimChoice = 'customer' | 'product' | 'division';

const DIM_OPTIONS: { value: DimChoice; label: string; key: DimensionKey }[] = [
  { value: 'customer', label: '고객', key: 'customer' },
  { value: 'product', label: '제품', key: 'product' },
  { value: 'division', label: '부문', key: 'division' },
];

interface BubblePoint {
  name: string;
  /** X: 매출 YoY (%) */
  yoy: number;
  /** Y: 영업이익률 (%) */
  margin: number;
  /** Z: 매출(기준 연도, 백만원). 버블 크기 */
  revenue: number;
  baseRevenue: number;
  compareRevenue: number;
  opIncome: number;
}

function fmtMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n === 0) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

/**
 * 7. 매출 YoY × 영업이익률 버블 차트.
 *
 * - X = 매출 YoY (%) — 기준 연도 매출 / 비교 연도 매출 - 1
 * - Y = 영업이익률 (%) — 기준 연도 영업이익 / 기준 연도 매출
 * - 버블 크기 = 기준 연도 매출 (Z축)
 * - 차원 선택: 고객 / 제품 / 부문 중 1개
 *
 * 성능: basis 토글 시 `annualByBasis[basis]` 작은 배열만 사용.
 */
export default function MarginScatter({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const [dim, setDim] = useState<DimChoice>('customer');

  const basisEntries = annualByBasis[basis];

  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );

  const defaultBase = yearLabels[yearLabels.length - 1] ?? '';
  const defaultCompare = yearLabels[yearLabels.length - 2] ?? defaultBase;
  const [baseYear, setBaseYear] = useState<string>('');
  const [compareYear, setCompareYear] = useState<string>('');
  const effBase = useMemo(
    () => (baseYear && yearLabels.includes(baseYear) ? baseYear : defaultBase),
    [baseYear, yearLabels, defaultBase]
  );
  const effCompare = useMemo(
    () => (compareYear && yearLabels.includes(compareYear) ? compareYear : defaultCompare),
    [compareYear, yearLabels, defaultCompare]
  );

  const dimConfig = useMemo(
    () => DIM_OPTIONS.find((d) => d.value === dim) ?? DIM_OPTIONS[0],
    [dim]
  );

  const points: BubblePoint[] = useMemo(() => {
    if (!effBase) return [];
    const baseEntries = entriesForYear(basisEntries, basis, effBase);
    const compareEntries = entriesForYear(basisEntries, basis, effCompare);
    const baseAgg = aggregateBy(baseEntries, [dimConfig.key]);
    const compareAgg = aggregateBy(compareEntries, [dimConfig.key]);
    const compareMap = new Map<string, number>();
    for (const r of compareAgg) {
      compareMap.set(r.dims[dimConfig.key] || '(미분류)', r.revenue);
    }
    return baseAgg
      .filter((r) => r.revenue > 0)
      .map((r) => {
        const name = r.dims[dimConfig.key] || '(미분류)';
        const cmp = compareMap.get(name) ?? 0;
        const yoy = cmp !== 0 ? ((r.revenue - cmp) / Math.abs(cmp)) * 100 : 0;
        return {
          name,
          yoy,
          margin: opMarginOf(r) ?? 0,
          revenue: r.revenue,
          baseRevenue: r.revenue,
          compareRevenue: cmp,
          opIncome: r.op_income,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [basisEntries, basis, effBase, effCompare, dimConfig.key]);

  const maxRev = useMemo(() => points.reduce((m, p) => Math.max(m, p.revenue), 0), [points]);

  /** 축에 0이 항상 보이도록 domain을 [min(0, dataMin)-pad, max(0, dataMax)+pad]로 강제 */
  const xDomain = useMemo<[number, number]>(() => {
    if (points.length === 0) return [-10, 10];
    let lo = 0;
    let hi = 0;
    for (const p of points) {
      if (p.yoy < lo) lo = p.yoy;
      if (p.yoy > hi) hi = p.yoy;
    }
    const pad = Math.max(Math.abs(lo), Math.abs(hi)) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }, [points]);

  const yDomain = useMemo<[number, number]>(() => {
    if (points.length === 0) return [-10, 10];
    let lo = 0;
    let hi = 0;
    for (const p of points) {
      if (p.margin < lo) lo = p.margin;
      if (p.margin > hi) hi = p.margin;
    }
    const pad = Math.max(Math.abs(lo), Math.abs(hi)) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }, [points]);

  const h = useChartHeight(280, 380, 460);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-base font-semibold">7. 매출 YoY × 영업이익률 (버블=매출)</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect label="기준" options={yearLabels} value={effBase} onChange={setBaseYear} />
          <YearSelect
            label="비교"
            options={yearLabels}
            value={effCompare}
            onChange={setCompareYear}
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
              dataKey="yoy"
              name="매출 YoY"
              domain={xDomain}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 11 }}
              label={{
                value: `매출 YoY (${effBase} vs ${effCompare}, %)`,
                position: 'insideBottom',
                offset: -10,
                style: { fontSize: 11, fill: 'var(--muted-foreground)' },
              }}
            />
            <YAxis
              type="number"
              dataKey="margin"
              name="영업이익률"
              domain={yDomain}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 11 }}
              label={{
                value: '영업이익률 (%)',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 11, fill: 'var(--muted-foreground)' },
              }}
            />
            <ZAxis
              type="number"
              dataKey="revenue"
              range={[80, 800]}
              domain={[0, Math.max(maxRev, 1)]}
              name="매출"
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '12px',
              }}
              content={<BubbleTooltip baseYear={effBase} compareYear={effCompare} />}
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

function BubbleTooltip({
  active,
  payload,
  baseYear,
  compareYear,
}: {
  active?: boolean;
  payload?: Array<{ payload: BubblePoint }>;
  baseYear: string;
  compareYear: string;
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
      <div>
        매출 {baseYear}: <span className="font-medium">{fmtMillion(p.baseRevenue)}</span> 백만원
      </div>
      <div>
        매출 {compareYear}: <span className="font-medium">{fmtMillion(p.compareRevenue)}</span>{' '}
        백만원
      </div>
      <div>매출 YoY: {fmtPct(p.yoy)}</div>
      <div>영업이익률: {fmtPct(p.margin)}</div>
      <div className={p.opIncome < 0 ? 'text-red-500' : ''}>
        영업이익: {fmtMillion(p.opIncome)} 백만원
      </div>
    </div>
  );
}

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
