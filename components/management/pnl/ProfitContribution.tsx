'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { AggregatedRow, Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/** 고객이 '기타'(미상/잡거래처)인 행은 TOP/WORST 랭킹에서 제외 — 분석 의미 약함.
 * (제품과 무관하게 customer='기타'면 모두 제외; 단 corp 합계·나머지 합계엔 그대로 포함.) */
function isCatchall(r: AggregatedRow): boolean {
  return r.dims.customer === '기타';
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}
function fmtPct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}
function marginOf(revenue: number, op: number): number | null {
  return revenue ? (op / revenue) * 100 : null;
}
function negCls(n: number | null | undefined): string {
  return n != null && n < 0 ? 'text-red-500' : '';
}

interface SummaryAgg {
  revenue: number;
  op_income: number;
}

function sumAgg(rows: readonly AggregatedRow[]): SummaryAgg {
  let revenue = 0;
  let op_income = 0;
  for (const r of rows) {
    revenue += r.revenue;
    op_income += r.op_income;
  }
  return { revenue, op_income };
}

export default function ProfitContribution({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const basisEntries = annualByBasis[basis];
  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );
  const [yearLabel, setYearLabel] = useState<string>('');
  const effYear = useMemo(
    () =>
      yearLabel && yearLabels.includes(yearLabel)
        ? yearLabel
        : (yearLabels[yearLabels.length - 1] ?? ''),
    [yearLabel, yearLabels]
  );

  const { top, worst, corp } = useMemo(() => {
    const entries = entriesForYear(basisEntries, basis, effYear);
    const cross = aggregateBy(entries, ['customer', 'product']).filter(
      (r) => (r.revenue !== 0 || r.op_income !== 0) && !isCatchall(r)
    );
    const sorted = [...cross].sort((a, b) => b.op_income - a.op_income);
    const top10 = sorted.slice(0, 10);
    const worst10 = [...sorted].slice(-10).reverse(); // 최하위가 위로
    const corpAgg = aggregateBy(entries, []);
    const corpRow = corpAgg[0] ?? null;
    return { top: top10, worst: worst10, corp: corpRow };
  }, [basisEntries, basis, effYear]);

  const corpSummary: SummaryAgg = corp
    ? { revenue: corp.revenue, op_income: corp.op_income }
    : { revenue: 0, op_income: 0 };

  const topAgg = sumAgg(top);
  const worstAgg = sumAgg(worst);
  const restOfTop: SummaryAgg = {
    revenue: corpSummary.revenue - topAgg.revenue,
    op_income: corpSummary.op_income - topAgg.op_income,
  };
  const restOfWorst: SummaryAgg = {
    revenue: corpSummary.revenue - worstAgg.revenue,
    op_income: corpSummary.op_income - worstAgg.op_income,
  };

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">11. 이익기여도 TOP10 / WORST10 (고객·제품)</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect label="연도" options={yearLabels} value={effYear} onChange={setYearLabel} />
        </div>
      </header>
      <p className="text-xs text-muted-foreground mb-2">
        단위 백만원 · (고객·제품) cross 기준 · 고객=&apos;기타&apos; 제외 · 영업이익 순
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ContribTable
          title="이익기여 TOP 10"
          summaryLabel="TOP10"
          rows={top}
          corp={corpSummary}
          groupSum={topAgg}
          rest={restOfTop}
        />
        <ContribTable
          title="이익기여 WORST 10"
          summaryLabel="WORST10"
          rows={worst}
          corp={corpSummary}
          groupSum={worstAgg}
          rest={restOfWorst}
        />
      </div>
    </section>
  );
}

interface ContribTableProps {
  title: string;
  summaryLabel: string;
  rows: AggregatedRow[];
  corp: SummaryAgg;
  groupSum: SummaryAgg;
  rest: SummaryAgg;
}

/**
 * 합계행 2개(전사·TOP10|WORST10) + 10개 개별행 + 합계행 1개(나머지) 단일 테이블.
 * 이미지 레이아웃: 고객 | 제품 | 매출 | 영업이익 | 이익률.
 */
function ContribTable({ title, summaryLabel, rows, corp, groupSum, rest }: ContribTableProps) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="font-semibold mb-2">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 px-2">고객</th>
              <th className="text-left py-1.5 px-2">제품</th>
              <th className="text-right py-1.5 px-2">매출</th>
              <th className="text-right py-1.5 px-2">영업이익</th>
              <th className="text-right py-1.5 px-2">이익률</th>
            </tr>
          </thead>
          <tbody>
            <SummaryRow label1="전사" label2="합계" agg={corp} tone="corp" />
            <SummaryRow label1={summaryLabel} label2="합계" agg={groupSum} tone="group" />
            {rows.map((r) => {
              const margin = marginOf(r.revenue, r.op_income);
              return (
                <tr key={r.key} className="border-b border-border/50">
                  <td className="py-1.5 px-2">{r.dims.customer || '—'}</td>
                  <td className="py-1.5 px-2">{r.dims.product || '—'}</td>
                  <td className="text-right py-1.5 px-2">{fmt(r.revenue)}</td>
                  <td className={`text-right py-1.5 px-2 ${negCls(r.op_income)}`}>
                    {fmt(r.op_income)}
                  </td>
                  <td className={`text-right py-1.5 px-2 ${negCls(margin)}`}>{fmtPct(margin)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  데이터 없음
                </td>
              </tr>
            ) : (
              <SummaryRow label1="나머지" label2="합계" agg={rest} tone="rest" />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryRow({
  label1,
  label2,
  agg,
  tone,
}: {
  label1: string;
  label2: string;
  agg: SummaryAgg;
  /** 'corp' = 전사 진한 파랑, 'group' = TOP10/WORST10 연한 파랑, 'rest' = 나머지 회색 */
  tone: 'corp' | 'group' | 'rest';
}) {
  const margin = marginOf(agg.revenue, agg.op_income);
  // 11번 차트(YoyMonthlyCompare)의 blue-600 solid / blue-600 0.45 톤을 표 행 음영에 매핑.
  const bgCls =
    tone === 'corp'
      ? 'bg-blue-200/80 dark:bg-blue-900/60'
      : tone === 'group'
        ? 'bg-blue-100/70 dark:bg-blue-900/30'
        : 'bg-slate-200 dark:bg-slate-700/60';
  const textCls = tone === 'rest' ? 'font-medium text-muted-foreground' : 'font-bold';
  return (
    <tr className={`border-b border-border/50 ${bgCls}`}>
      <td className={`py-1.5 px-2 ${textCls}`}>{label1}</td>
      <td className={`py-1.5 px-2 ${textCls}`}>{label2}</td>
      <td className={`text-right py-1.5 px-2 ${textCls}`}>{fmt(agg.revenue)}</td>
      <td className={`text-right py-1.5 px-2 ${textCls} ${negCls(agg.op_income)}`}>
        {fmt(agg.op_income)}
      </td>
      <td className={`text-right py-1.5 px-2 ${textCls} ${negCls(margin)}`}>{fmtPct(margin)}</td>
    </tr>
  );
}
