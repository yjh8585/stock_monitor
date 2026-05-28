'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import {
  aggregateBy,
  entriesForYear,
  getDisplayYearLabels,
  opMarginOf,
} from '@/lib/pnl/aggregate';
import type { AggregatedRow, Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}
function fmtPct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}

/** 영업이익률 음수 빨강 */
function marginCls(n: number | null): string {
  return n != null && n < 0 ? 'text-red-500 font-medium' : '';
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

  const { top, worst, corp, restOfTop } = useMemo(() => {
    const entries = entriesForYear(basisEntries, basis, effYear);
    const cross = aggregateBy(entries, ['customer', 'product']).filter(
      (r) => r.revenue !== 0 || r.op_income !== 0
    );
    const sorted = [...cross].sort((a, b) => b.op_income - a.op_income);
    const top7 = sorted.slice(0, 7);
    const worst7 = sorted.slice(-7).reverse(); // 최하위가 위로
    const corpAgg = aggregateBy(entries, []);
    const corpRow: AggregatedRow | null = corpAgg[0] ?? null;
    // top7 제외 나머지 합산
    const topKeys = new Set(top7.map((r) => r.key));
    const rest = cross.filter((r) => !topKeys.has(r.key));
    const restRev = rest.reduce((s, r) => s + r.revenue, 0);
    const restOp = rest.reduce((s, r) => s + r.op_income, 0);
    return {
      top: top7,
      worst: worst7,
      corp: corpRow,
      restOfTop: { revenue: restRev, op_income: restOp },
    };
  }, [basisEntries, basis, effYear]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">10. 이익기여도 TOP7 / WORST7 (고객·제품)</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect label="연도" options={yearLabels} value={effYear} onChange={setYearLabel} />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ContribTable title="이익기여 TOP 7" rows={top} />
        <ContribTable title="이익기여 WORST 7" rows={worst} />
      </div>

      {corp ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 px-2">구분</th>
                <th className="text-right py-1.5 px-2">매출(백만)</th>
                <th className="text-right py-1.5 px-2">영업이익(백만)</th>
                <th className="text-right py-1.5 px-2">영업이익률</th>
              </tr>
            </thead>
            <tbody>
              <SummaryRow label="전사 합계" revenue={corp.revenue} op={corp.op_income} />
              <SummaryRow
                label="TOP7 제외 나머지"
                revenue={restOfTop.revenue}
                op={restOfTop.op_income}
              />
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function SummaryRow({ label, revenue, op }: { label: string; revenue: number; op: number }) {
  const margin = revenue ? (op / revenue) * 100 : null;
  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 px-2 font-medium">{label}</td>
      <td className="text-right py-1.5 px-2">{fmt(revenue)}</td>
      <td className={`text-right py-1.5 px-2 ${op < 0 ? 'text-red-500' : ''}`}>{fmt(op)}</td>
      <td className={`text-right py-1.5 px-2 ${marginCls(margin)}`}>{fmtPct(margin)}</td>
    </tr>
  );
}

function ContribTable({ title, rows }: { title: string; rows: AggregatedRow[] }) {
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
            {rows.map((r) => {
              const margin = opMarginOf(r);
              return (
                <tr key={r.key} className="border-b border-border/50">
                  <td className="py-1.5 px-2">{r.dims.customer || '—'}</td>
                  <td className="py-1.5 px-2">{r.dims.product || '—'}</td>
                  <td className="text-right py-1.5 px-2">{fmt(r.revenue)}</td>
                  <td className={`text-right py-1.5 px-2 ${r.op_income < 0 ? 'text-red-500' : ''}`}>
                    {fmt(r.op_income)}
                  </td>
                  <td className={`text-right py-1.5 px-2 ${marginCls(margin)}`}>{fmtPct(margin)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  데이터 없음
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
