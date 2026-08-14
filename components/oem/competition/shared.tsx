'use client';

/**
 * `/oem/competition` 전용 공용 토큰·조각.
 *
 * 차트 7종이 색·카드 껍데기·기준기간 배지를 각자 리터럴로 들고 있으면 조금씩 갈린다.
 * 여기에 한 번만 정의하고 전부 재사용한다. 팔레트·툴팁·그리드 같은 **전역** 토큰은
 * `components/charts/*` 와 `components/oem-companies/common/chartStyle.ts` 를 그대로 쓴다.
 */
import { useState, type ReactNode } from 'react';
import { OEM_COLORS } from '@/components/charts/palette';
import type { Signal } from '@/lib/oem-competition/signals';
import type { CompetitionMarket, PeriodAggregate, PeriodBasis } from '@/lib/oem-competition/types';

/** 대상 차종은 항상 이 색. 경쟁 차종은 회색 계열이라 대상이 한눈에 도드라진다. */
export const TARGET_COLOR = '#2563eb';

/** 경쟁 차종 색(판매 순). 대상(파랑)과 겹치지 않는 중립~보조 색만 쓴다. */
export const RIVAL_COLORS = ['#94a3b8', '#cbd5e1', '#64748b', '#e2e8f0'];

export function rivalColor(index: number): string {
  return RIVAL_COLORS[index % RIVAL_COLORS.length];
}

/**
 * 경쟁 차종을 **서로** 구별해야 하는 차트(레이더처럼 도형이 겹치는 경우)용 색.
 *
 * 위의 회색 계열은 "대상 vs 나머지"를 가르는 데 맞춰져 있어 경쟁끼리는 구분이 안 된다. 공용
 * `OEM_COLORS` 에서 고르되 **신호등 색(초록 #16a34a · 빨강 #dc2626)은 뺀다** — 같은 페이지에서
 * 그 둘은 이미 "좋다/나쁘다"를 뜻해, 차종 이름표로 쓰면 평가로 오독된다.
 */
export const RIVAL_DISTINCT_COLORS = [
  OEM_COLORS[6], // orange-600
  OEM_COLORS[4], // purple-600
  OEM_COLORS[8], // pink-600
  OEM_COLORS[7], // lime-600
  OEM_COLORS[9], // slate-600
  // 🔴 cyan(OEM_COLORS[5])은 뺐다 — 대상 파랑(#2563eb)과 나란히 놓으면 레이더에서 둘이 구분되지
  // 않는다(2026-08-14 화면 확인). 신호등 색과 마찬가지로 "쓰면 안 되는 색" 이다.
];

export function rivalDistinctColor(index: number): string {
  return RIVAL_DISTINCT_COLORS[index % RIVAL_DISTINCT_COLORS.length];
}

/**
 * 재고 카드 2종(최신 막대 · 추이 라인)이 함께 긋는 업계 관행선.
 * 🔴 두 카드가 **같은 지표를 다르게 그으면** 어느 쪽이 맞는지 알 수 없다 → 상수는 한 곳에만 둔다.
 * 신호등 임계값(75/110일, `signals.ts`)과는 별개의 값이다.
 */
export const INDUSTRY_NORMAL_DAYS = 60;

export const SIGNAL_COLORS: Record<Signal, string> = {
  GREEN: '#16a34a',
  YELLOW: '#f59e0b',
  RED: '#dc2626',
};

/** 신호등 점 하나. signal 이 null 이면 회색(판정 불가) — 노랑으로 뭉개지 않는다. */
export function SignalDot({
  signal,
  size = 10,
  title,
}: {
  signal: Signal | null;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      aria-label={signal ?? '판정 불가'}
      className="inline-block rounded-full align-middle"
      style={{
        width: size,
        height: size,
        backgroundColor: signal ? SIGNAL_COLORS[signal] : 'var(--muted-foreground)',
        opacity: signal ? 1 : 0.35,
      }}
    />
  );
}

/**
 * 차트 한 칸의 껍데기 — 제목·부제·본문. 카드 스타일을 7곳에 복붙하지 않기 위한 것.
 * `actions` 는 제목 오른쪽 자리(기준 버튼·지표 토글). 좁은 화면에서는 제목 아래로 접힌다.
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-border bg-card px-4 py-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        {actions}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** 세그먼트 버튼 한 벌 — 기준 전환(최근 12개월/올해 누계)과 지표 전환(리콜/불만) 공용. */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  if (options.length < 2) return null;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 rounded-md border border-border p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`rounded px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 버튼에 쓰는 짧은 이름. 카드 부제에는 기간이 박힌 긴 이름(`PeriodAggregate.label`)을 쓴다. */
const BASIS_SHORT: Record<PeriodBasis, string> = { L12M: '최근 12개월', YTD: '올해 누계' };

const BASIS_HINT: Record<PeriodBasis, string> = {
  L12M: '기준월부터 12개월 누계 — 계절성이 상쇄돼 수준 비교에 맞다',
  YTD: '올해 1월부터 기준월까지 누계 — 연초 이후의 흐름을 본다',
};

/**
 * 기준 전환 상태 + 선택된 집계.
 *
 * 순위·점유율·시장 내 위치 세 차트가 각자 버튼을 갖는다(사용자 지시 2026-08-14). 상태를 공유하면
 * 한 차트를 눌렀는데 다른 차트가 따라 바뀌어 예상 밖 동작이 된다.
 */
export function usePeriodBasis(periods: PeriodAggregate[]) {
  const [basis, setBasis] = useState<PeriodBasis>('L12M');
  const active = periods.find((p) => p.basis === basis) ?? periods[0] ?? null;
  const options = periods.map((p) => ({
    value: p.basis,
    label: BASIS_SHORT[p.basis],
    title: BASIS_HINT[p.basis],
  }));
  return { active, options, basis: active?.basis ?? basis, setBasis };
}

/** 데이터가 없을 때의 자리 — 차트마다 문구가 달라지지 않게 한 곳에서 만든다. */
export function EmptyChart({ reason }: { reason: string }) {
  return <div className="py-10 text-center text-xs text-muted-foreground">{reason}</div>;
}

/**
 * 대상 차종 이름 — `CompetitionMarket` 에 이름 필드가 없어 대상 플래그가 붙은 배열에서 빌려 온다.
 * 둘 다 비어도 차트는 그려야 하므로 마지막에 총칭으로 떨어진다.
 */
export function targetModelName(market: CompetitionMarket): string {
  return (
    market.series.find((s) => s.isTarget)?.model ??
    market.consumerScores.find((s) => s.is_target)?.model ??
    '대상 차종'
  );
}

/** 순위·산점도가 함께 쓰는 최소 행. 기준 버튼이 있든 없든 같은 모양으로 맞춘다. */
export interface ModelRow {
  model: string;
  sales: number;
  yoyPct: number | null;
  isTarget: boolean;
}

/**
 * 선택된 기준(active)의 재집계를 쓰고, 월별 뷰에 그 시장이 없으면 저장 스냅샷으로 떨어진다.
 * 두 경로의 모양을 여기서 합쳐 두어야 차트마다 분기가 늘지 않는다.
 */
export function modelRows(market: CompetitionMarket, active: PeriodAggregate | null): ModelRow[] {
  const name = targetModelName(market);
  if (active) {
    return active.models.map((m) => ({
      model: m.isTarget ? name : m.model,
      sales: m.sales,
      yoyPct: m.yoyPct,
      isTarget: m.isTarget,
    }));
  }
  return [
    { model: name, sales: market.sales, yoyPct: market.yoyPct, isTarget: true },
    ...market.competitors.map((c) => ({
      model: c.model,
      sales: c.sales,
      yoyPct: c.yoy_pct,
      isTarget: false,
    })),
  ];
}

/** 선택된 기준을 반영한 기간 표기. 기준 버튼이 없는 시장은 저장값 기준으로 떨어진다. */
export function basisPeriodLabel(
  market: Pick<CompetitionMarket, 'anchorMonth' | 'months'>,
  active: PeriodAggregate | null
): string {
  if (!active) return periodLabel(market);
  return `${fmtYmFull(active.anchorMonth)} 기준 ${active.label}`;
}

/** "2026.07 기준 12개월 누계" — 판매량이 월간 실적으로 오해되지 않게 항상 붙인다. */
export function periodLabel(market: Pick<CompetitionMarket, 'anchorMonth' | 'months'>): string {
  if (!market.months) return '';
  if (!market.anchorMonth) return `최근 ${market.months}개월 누계`;
  const ym = String(market.anchorMonth);
  return `${ym.slice(0, 4)}.${ym.slice(4, 6)} 기준 ${market.months}개월 누계`;
}

/** YYYYMM → "24.08" (축 라벨용, 폭이 좁다) */
export function fmtYm(ym: number): string {
  const s = String(ym);
  return `${s.slice(2, 4)}.${s.slice(4, 6)}`;
}

/** YYYYMM → "2026.07" (툴팁·본문용) */
export function fmtYmFull(ym: number): string {
  const s = String(ym);
  return `${s.slice(0, 4)}.${s.slice(4, 6)}`;
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** 차종명이 길면 축·범례가 밀린다. 괄호 안 부연을 떼되 'Ram P/U' 처럼 의미 있는 슬래시는 남긴다. */
export function shortModel(name: string): string {
  return name.split('(')[0].trim() || name;
}

/** 점유율 '수준' 표기. fmtPct 는 양수에 +를 붙이는 증감용이라 수준값에 쓰면 "+12.3%"가 된다. */
export function fmtLevel(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)}%`;
}

/** 점유율 변화는 %(비율)가 아니라 %p(포인트)다 — 단위를 섞으면 1.8배와 1.8%p 가 뒤엉킨다. */
export function fmtPp(delta: number | null | undefined, digits = 1): string {
  if (delta === null || delta === undefined) return '—';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(digits)}%p`;
}

/**
 * 증감 한 조각 — 값과 색을 함께. `goodWhenUp=false` 는 재고일수처럼 **늘면 나쁜** 지표용이다
 * (색을 뒤집지 않으면 재고 급증이 초록으로 표시된다).
 */
export function DeltaText({
  value,
  text,
  goodWhenUp = true,
  className = '',
}: {
  value: number | null | undefined;
  text: string;
  goodWhenUp?: boolean;
  className?: string;
}) {
  const good = value === null || value === undefined ? null : goodWhenUp ? value > 0 : value < 0;
  const color =
    value === null || value === undefined || value === 0
      ? 'var(--muted-foreground)'
      : good
        ? SIGNAL_COLORS.GREEN
        : SIGNAL_COLORS.RED;
  return (
    <span className={`tabular-nums ${className}`} style={{ color }}>
      {text}
    </span>
  );
}

/** 미국 전용 지표(Cox·NHTSA)가 이 시장에 어떤 자격으로 붙었는지 — 카드 부제에 항상 붙인다. */
export function UsMetricBadge({ basis }: { basis: CompetitionMarket['usMetricsBasis'] }) {
  if (basis === null) return null;
  const reference = basis === 'reference';
  return (
    <span
      className="ml-1.5 inline-block rounded px-1.5 py-0.5 align-middle text-[11px] font-medium"
      style={{
        backgroundColor: reference ? 'var(--muted)' : 'transparent',
        border: '1px solid var(--border)',
      }}
      title={
        reference
          ? '이 시장은 글로벌인데 Cox·NHTSA 는 미국 데이터다. 참고치로만 싣고 신호등 등급은 매기지 않는다.'
          : '이 시장이 곧 미국이라 Cox·NHTSA 를 그 시장의 사실로 쓴다.'
      }
    >
      {reference ? '미국 참고치 · 등급 판정 제외' : '미국 시장 기준'}
    </span>
  );
}
