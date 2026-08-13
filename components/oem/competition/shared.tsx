'use client';

/**
 * `/oem/competition` 전용 공용 토큰·조각.
 *
 * 차트 7종이 색·카드 껍데기·기준기간 배지를 각자 리터럴로 들고 있으면 조금씩 갈린다.
 * 여기에 한 번만 정의하고 전부 재사용한다. 팔레트·툴팁·그리드 같은 **전역** 토큰은
 * `components/charts/*` 와 `components/oem-companies/common/chartStyle.ts` 를 그대로 쓴다.
 */
import type { ReactNode } from 'react';
import type { Signal } from '@/lib/oem-competition/signals';
import type { CompetitionMarket } from '@/lib/oem-competition/types';

/** 대상 차종은 항상 이 색. 경쟁 차종은 회색 계열이라 대상이 한눈에 도드라진다. */
export const TARGET_COLOR = '#2563eb';

/** 경쟁 차종 색(판매 순). 대상(파랑)과 겹치지 않는 중립~보조 색만 쓴다. */
export const RIVAL_COLORS = ['#94a3b8', '#cbd5e1', '#64748b', '#e2e8f0'];

export function rivalColor(index: number): string {
  return RIVAL_COLORS[index % RIVAL_COLORS.length];
}

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

/** 차트 한 칸의 껍데기 — 제목·부제·본문. 카드 스타일을 7곳에 복붙하지 않기 위한 것. */
export function ChartCard({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-border bg-card p-3 ${className}`}>
      <div className="text-sm font-medium">{title}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** 데이터가 없을 때의 자리 — 차트마다 문구가 달라지지 않게 한 곳에서 만든다. */
export function EmptyChart({ reason }: { reason: string }) {
  return <div className="py-10 text-center text-xs text-muted-foreground">{reason}</div>;
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
