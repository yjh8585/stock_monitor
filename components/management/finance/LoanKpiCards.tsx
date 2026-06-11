'use client';

import type { LoanKpis } from '@/lib/finance/types';

function fmt(n: number | null, digits = 0, suffix = ''): string {
  if (n === null || Number.isNaN(n)) return '—';
  return (
    n.toLocaleString('ko-KR', {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }) + suffix
  );
}

interface Props {
  kpis: LoanKpis;
}

/** 대여금 KPI 3장 — 누적 / 당월 / 2026 YTD 계획 대비 지급율. */
export default function LoanKpiCards({ kpis }: Props) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Card title="누적 대여금" sub="2025~ 실적 누계">
        <div className="text-2xl font-semibold">{fmt(kpis.cumulativeEok, 1, ' 억원')}</div>
      </Card>
      <Card title="당월 대여금" sub={`기준 ${kpis.latestLabel}`}>
        <div className="text-2xl font-semibold">{fmt(kpis.currentMonthEok, 1, ' 억원')}</div>
      </Card>
      <Card title="계획 대비 지급율" sub="2026 YTD · vs 동기간 계획">
        <div className="text-2xl font-semibold">{fmt(kpis.paymentRatePct, 1, '%')}</div>
        <div className="text-sm text-muted-foreground mt-1">
          실적 {fmt(kpis.ytdActualEok, 0)} / 계획 {fmt(kpis.ytdPlanEok, 0)} 억원
        </div>
      </Card>
    </section>
  );
}

function Card({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      {children}
    </div>
  );
}
