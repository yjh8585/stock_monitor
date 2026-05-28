'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import { useChartHeight } from '@/lib/useChartHeight';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

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
  /** 같은 행의 매출액 — 툴팁에서 비율 계산용 */
  revenueRef: number;
  /** recharts Bar가 직접 읽는 fill (Cell 없이 데이터 단위로 색 지정) */
  fill: string;
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
  const partial: Omit<WaterfallBar, 'fill'>[] = [];

  partial.push({
    name: '매출',
    base: 0,
    value: revenue,
    display: revenue,
    kind: 'absolute',
    revenueRef: revenue,
  });

  const subtract = (name: string, amount: number) => {
    running -= amount;
    partial.push({
      name,
      base: running,
      value: amount,
      display: -amount,
      kind: 'subtract',
      revenueRef: revenue,
    });
  };

  subtract('재료비', materialCost);
  subtract('노무비', laborCost);
  subtract('경비', expense);
  subtract('판관비', sga);
  subtract('연구비', rnd);

  partial.push({
    name: '영업이익',
    base: 0,
    value: opIncome,
    display: opIncome,
    kind: 'absolute',
    revenueRef: revenue,
  });

  return partial.map((b) => ({ ...b, fill: barColor(b) }));
}

/** 막대 색상: 매출=파랑, 나머지(비용·영업이익 흑자)=회색, 영업이익 적자만 빨강. */
function barColor(b: Omit<WaterfallBar, 'fill'>): string {
  if (b.name === '매출') return '#2563eb';
  if (b.name === '영업이익' && b.display < 0) return '#dc2626';
  return '#9ca3af';
}

/**
 * 13-1. 수익성 워터폴.
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
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h2 className="text-lg font-semibold">14. 수익성 워터폴</h2>
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
            <XAxis dataKey="name" tick={{ fontSize: 14 }} interval={0} />
            <YAxis
              tickFormatter={(v: number) => fmtMillion(v)}
              tick={{ fontSize: 14 }}
              width={80}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '16px',
              }}
              content={<WaterfallTooltip />}
            />
            {/* invisible base */}
            <Bar dataKey="base" stackId="wf" fill="transparent" />
            {/* visible delta — 데이터의 fill 필드를 막대별로 적용 */}
            <Bar dataKey="value" stackId="wf" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

function fmtRatio(part: number, total: number): string | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) return null;
  const pct = (part / total) * 100;
  return `${pct.toFixed(1)}%`;
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
  const isRevenue = b.name === '매출';
  // subtract 막대(비용)는 호버 시 절대값으로 표시. 영업이익 적자는 음수 그대로.
  const shownAmount = b.kind === 'subtract' ? Math.abs(b.display) : b.display;
  // 비율: 비용은 절대값(양수), 영업이익은 부호 유지(적자면 음수).
  const ratioInput = b.kind === 'subtract' ? Math.abs(b.display) : b.display;
  const ratio = isRevenue ? null : fmtRatio(ratioInput, b.revenueRef);
  const isNegative = shownAmount < 0;
  const valueClass = isNegative ? 'text-red-500' : '';
  const ratioClass = isNegative ? 'text-red-500' : 'text-muted-foreground';
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="font-semibold mb-1">{b.name}</div>
      <div className={valueClass}>{fmtMillion(shownAmount)} 백만원</div>
      {ratio ? <div className={`mt-0.5 ${ratioClass}`}>매출액 대비 {ratio}</div> : null}
    </div>
  );
}
