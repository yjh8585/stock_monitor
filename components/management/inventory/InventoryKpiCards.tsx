'use client';

import type { InventoryKpis } from '@/lib/inventory/types';

function fmt(n: number | null, digits = 0, suffix = ''): string {
  if (n === null || Number.isNaN(n)) return '—';
  return (
    n.toLocaleString('ko-KR', {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }) + suffix
  );
}

function ArrowPct({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const up = value >= 0;
  return (
    <span className={up ? 'text-blue-600' : 'text-red-600'}>
      {up ? '▲' : '▼'} {fmt(Math.abs(value), 1, '%')}
    </span>
  );
}

function AchievementBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const good = value >= 100;
  return <span className={good ? 'text-emerald-600' : 'text-red-600'}>{fmt(value, 1, '%')}</span>;
}

interface Props {
  kpis: InventoryKpis;
}

export default function InventoryKpiCards({ kpis }: Props) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card title="전체 재고" sub={`기준 ${kpis.latestLabel}`}>
        <div className="text-2xl font-semibold">{fmt(kpis.totalEok, 0, ' 억원')}</div>
        <div className="text-sm mt-1">
          전월비 <ArrowPct value={kpis.totalMomPct} />
        </div>
      </Card>
      <Card title="재고 회전율" sub={`기준 ${kpis.latestLabel}`}>
        <div className="text-2xl font-semibold">{fmt(kpis.turnover, 1, ' 회')}</div>
        <div className="text-sm text-muted-foreground mt-1">
          ≈ {kpis.turnoverDays === null ? '—' : `${kpis.turnoverDays}일치`}
        </div>
      </Card>
      <Card title="계획 달성율" sub={`기준 ${kpis.latestLabel}, 전체`}>
        <div className="text-2xl font-semibold">
          <AchievementBadge value={kpis.achievementPct} />
        </div>
        <div className="text-sm text-muted-foreground mt-1">실적 ÷ 계획 × 100</div>
      </Card>
      <Card title="운송 비중" sub={`기준 ${kpis.latestLabel}`}>
        <div className="text-2xl font-semibold">{fmt(kpis.transportSharePct, 1, '%')}</div>
        <div className="text-sm text-muted-foreground mt-1">운송 ÷ 전체 × 100</div>
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
