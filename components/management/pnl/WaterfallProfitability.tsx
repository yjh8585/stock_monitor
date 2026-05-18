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

const BarChart = dynamic(() => import('recharts').then((m) => m.BarChart), {
  ssr: false,
  loading: ChartFallback,
});
const Bar = dynamic(() => import('recharts').then((m) => m.Bar), { ssr: false });
const Cell = dynamic(() => import('recharts').then((m) => m.Cell), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then((m) => m.CartesianGrid), {
  ssr: false,
});
const Tooltip = dynamic(() => import('recharts').then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer), {
  ssr: false,
});

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

interface WaterfallBar {
  name: string;
  /** invisible base (stack 시작점) */
  base: number;
  /** 가시 막대 길이 (절대값) */
  value: number;
  /** 표시값 (음수 비용은 음수) */
  display: number;
  /** 카테고리: 'absolute' = 누적값, 'subtract' = 비용 차감 */
  kind: 'absolute' | 'subtract';
}

function fmtMillion(n: number): string {
  if (Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

/** 워터폴 데이터 빌더 — 매출 → 비용 차감 → 영업이익 (매출총이익 단계는 표시하지 않음). */
function buildWaterfall(row: {
  revenue: number;
  material_cost: number;
  labor_cost: number;
  expense: number;
  sga: number;
  rnd: number;
  op_income: number;
}): WaterfallBar[] {
  const revenue = row.revenue;
  const materialCost = row.material_cost;
  const laborCost = row.labor_cost;
  const expense = row.expense;
  const sga = row.sga;
  const rnd = row.rnd;
  const opIncome = row.op_income;

  // 누적 잔액 (각 단계 시작점). 영업이익이 음수면 base가 음수가 되므로 BarChart도 음수 영역에 그려진다.
  let running = revenue;
  const bars: WaterfallBar[] = [];

  bars.push({ name: '매출', base: 0, value: revenue, display: revenue, kind: 'absolute' });

  const subtract = (name: string, amount: number) => {
    running -= amount;
    bars.push({ name, base: running, value: amount, display: -amount, kind: 'subtract' });
  };

  subtract('재료비', materialCost);
  subtract('노무비', laborCost);
  subtract('경비', expense);
  subtract('판관비', sga);
  subtract('연구비', rnd);

  bars.push({ name: '영업이익', base: 0, value: opIncome, display: opIncome, kind: 'absolute' });
  return bars;
}

/** 막대 색상: 매출=파랑, 비용 차감=빨강, 영업이익=흑자 초록 / 적자 빨강 */
function barColor(b: WaterfallBar): string {
  if (b.kind === 'subtract') return '#dc2626';
  if (b.name === '영업이익') return b.display < 0 ? '#dc2626' : '#16a34a';
  return '#2563eb';
}

/**
 * 10-1. 수익성 워터폴.
 *
 * - basis 토글 + 단일 연도 선택
 * - 매출 → −재료비 → −노무비 → −경비 → 매출총이익 → −판관비 → −연구비 → 영업이익
 */
export default function WaterfallProfitability({ annualByBasis }: Props) {
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

  const bars: WaterfallBar[] = useMemo(() => {
    if (!effectiveYear) return [];
    const yearEntries = entriesForYear(basisEntries, basis, effectiveYear);
    const agg = aggregateBy(yearEntries, []);
    if (agg.length === 0) return [];
    const row = agg[0];
    return buildWaterfall({
      revenue: row.revenue,
      material_cost: row.material_cost,
      labor_cost: row.labor_cost,
      expense: row.expense,
      sga: row.sga,
      rnd: row.rnd,
      op_income: row.op_income,
    });
  }, [basisEntries, basis, effectiveYear]);

  const h = useChartHeight(280, 360, 420);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-sm font-medium">수익성 워터폴</div>
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
      {bars.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={bars} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" tick={{ fontSize: 13 }} interval={0} />
            <YAxis
              tickFormatter={(v: number) => fmtMillion(v)}
              tick={{ fontSize: 13 }}
              width={80}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '12px',
              }}
              content={<WaterfallTooltip />}
            />
            {/* invisible base */}
            <Bar dataKey="base" stackId="wf" fill="transparent" />
            {/* visible delta — 매출=파랑 / 비용=빨강 / 영업이익 흑자=초록·적자=빨강 */}
            <Bar dataKey="value" stackId="wf" radius={[2, 2, 0, 0]}>
              {bars.map((b, i) => (
                <Cell key={i} fill={barColor(b)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: WaterfallBar }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const b = payload[0].payload;
  const label = b.kind === 'subtract' ? '차감' : '소계';
  return (
    <div
      className="rounded-md p-2 text-xs"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="font-semibold mb-1">{b.name}</div>
      <div className="text-muted-foreground">{label}</div>
      <div className={b.kind === 'subtract' ? 'text-red-500' : b.display < 0 ? 'text-red-500' : ''}>
        {fmtMillion(b.display)} 백만원
      </div>
    </div>
  );
}
