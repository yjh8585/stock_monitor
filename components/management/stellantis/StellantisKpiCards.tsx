import type { InventoryKpi, KpiMetric, TrafficLight } from '@/lib/stellantis-forecast/types';
import { fmt, fmtSigned } from './format';

/**
 * 스텔란티스 KPI 카드 4종 (server component — 상호작용 없어 클라이언트 JS를 안 태운다).
 *
 * 순서: 소매 판매 · 출하량 · 재고 증감 · 스텔란티스향 매출 (사용자 지시 2026-07-16).
 *  - 소매·출하·매출: **YTD YoY 증가율**(주) + **절대값 변화**(보조). YoY 부호로 ▲초록/▼빨강.
 *  - 재고 증감: **신호등**. 재고 증가(향후 감산 → 당사 매출 하방)면 빨강, 감소면 초록, 혼조면 노랑.
 *    "N분기 연속 재고 증가"처럼 간단히 서술한다.
 *
 * 매출은 사외비(억원)지만 이 페이지는 인증 사용자 전용이라 경영관리 다른 탭과 동일하게 표시한다.
 */
export default function StellantisKpiCards({
  metrics,
  inventory,
}: {
  metrics: KpiMetric[];
  inventory: InventoryKpi;
}) {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard metric={byKey.get('retail')} />
      <MetricCard metric={byKey.get('shipments')} />
      <InventoryCard kpi={inventory} />
      <MetricCard metric={byKey.get('revenue')} />
    </section>
  );
}

/** YTD YoY 값 카드. */
function MetricCard({ metric }: { metric?: KpiMetric }) {
  if (!metric || !metric.available) {
    return (
      <Shell title={metric?.label ?? ''} sub="—">
        <div className="text-3xl font-semibold text-muted-foreground">—</div>
        <div className="mt-1 text-sm text-muted-foreground">데이터 없음</div>
      </Shell>
    );
  }
  const unit = metric.unit === 'eok' ? '억원' : '대';
  const up = metric.yoyPct !== null && metric.yoyPct > 0;
  const down = metric.yoyPct !== null && metric.yoyPct < 0;
  const tone = up
    ? 'text-emerald-600 dark:text-emerald-400'
    : down
      ? 'text-red-600 dark:text-red-400'
      : 'text-foreground';
  const arrow = up ? '▲' : down ? '▼' : '';

  return (
    <Shell title={metric.label} sub={metric.periodLabel}>
      <div className={`text-3xl font-semibold tabular-nums ${tone}`}>
        {metric.yoyPct === null
          ? '—'
          : `${arrow} ${metric.yoyPct >= 0 ? '+' : ''}${metric.yoyPct.toFixed(1)}%`}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">전년 동기 대비 (YoY)</div>
      <div className="mt-2 text-sm text-muted-foreground">
        {metric.yoyPct === null ? (
          <span className="tabular-nums">
            당해 {fmt(metric.currentValue)}
            {unit} (전년 동기 데이터 없음)
          </span>
        ) : (
          <>
            <span className="tabular-nums">
              전년 {fmt(metric.priorValue)}
              {unit} → 당해 {fmt(metric.currentValue)}
              {unit}
            </span>{' '}
            <b className={`tabular-nums ${tone}`}>
              ({fmtSigned(metric.absChange)}
              {unit})
            </b>
          </>
        )}
      </div>
    </Shell>
  );
}

/** 재고 증감 신호등 카드. */
function InventoryCard({ kpi }: { kpi: InventoryKpi }) {
  const style: Record<TrafficLight, { dot: string; text: string; badge: string; ring: string }> = {
    red: {
      dot: 'bg-red-600',
      text: 'text-red-600 dark:text-red-400',
      badge: 'bg-red-600 text-white',
      ring: 'ring-red-500/40',
    },
    yellow: {
      dot: 'bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
      badge: 'bg-amber-500 text-white',
      ring: 'ring-amber-500/40',
    },
    green: {
      dot: 'bg-emerald-600',
      text: 'text-emerald-600 dark:text-emerald-400',
      badge: 'bg-emerald-600 text-white',
      ring: 'ring-emerald-500/40',
    },
  };
  const s = style[kpi.status];
  const badgeLabel = kpi.status === 'red' ? '주의' : kpi.status === 'green' ? '양호' : '중립';
  return (
    <div className={`rounded-xl bg-card p-4 ring-1 ${s.ring}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-muted-foreground">{kpi.label}</div>
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${s.badge}`}>
          {badgeLabel}
        </span>
      </div>
      <div className={`flex items-center gap-2 text-2xl font-semibold ${s.text}`}>
        <span className={`inline-block h-3 w-3 rounded-full ${s.dot}`} aria-hidden />
        {kpi.headline}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{kpi.detail}</div>
    </div>
  );
}

/** KPI 카드 껍데기. */
function Shell({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-right text-xs text-muted-foreground">{sub}</div>
      </div>
      {children}
    </div>
  );
}
