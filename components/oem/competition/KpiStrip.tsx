'use client';

/**
 * 시장 하나의 핵심 숫자 4개 + 항목별 신호등 + 증감.
 *
 * 차트를 보기 전에 "지금 어떤 상태인가"를 숫자로 먼저 잡아 준다. 차트는 추세를, 여기는 수준을
 * 담당한다. 다만 수준만으로는 방향을 알 수 없어 판매·점유율·유통재고에는 증감을 함께 싣는다
 * (사용자 지시 2026-08-14). 신호등을 숫자 옆에 붙여 두면 스코어보드로 되돌아가지 않아도 등급을 안다.
 */
import {
  evaluateMarket,
  inventoryDelta,
  shareDelta,
  targetInventory,
  targetSafety,
} from '@/lib/oem-competition/signals';
import type { SignalItemKey, SignalResult } from '@/lib/oem-competition/signals';
import type { CompetitionMarket } from '@/lib/oem-competition/types';
import { fmtFull } from '@/components/oem/helpers';
import { DeltaText, fmtPct, fmtPp, fmtYmFull, periodLabel, SignalDot } from './shared';

interface Tile {
  key: SignalItemKey;
  label: string;
  value: string;
  /** 값 아래 작은 글씨 — 무엇과 비교한 값인지. 숫자만 있으면 해석이 안 된다. */
  note: string;
  /** 값 오른쪽 증감. `goodWhenUp=false` 는 늘면 나쁜 지표(유통재고). */
  delta?: { value: number | null; text: string; goodWhenUp?: boolean };
}

/** 유통재고 칸의 보조 문구 — "왜 값이 없는가"가 "값이 얼마인가"만큼 중요하다. */
function inventoryNote(market: CompetitionMarket): string {
  const inv = targetInventory(market.inventory);
  if (!inv) return 'Cox 미제공 (미국 미판매·로스터 외)';
  const brand = `${inv.brand} 브랜드`;
  if (inv.outlierExcluded) {
    const month = inv.outlierMonth ? fmtYmFull(inv.outlierMonth) : '최신월';
    // 값이 없는 게 아니라 "너무 높아서 안 실렸다" — 아래 값은 마지막 공개월 것이다.
    return `${brand} · ${month} 미공개(평균 2배 초과) · 아래는 ${fmtYmFull(inv.year_month)} 값`;
  }
  return `${brand} · 미국 딜러 · ${fmtYmFull(inv.year_month)}`;
}

function buildTiles(market: CompetitionMarket): Tile[] {
  const inv = targetInventory(market.inventory);
  const saf = targetSafety(market.safety);
  const invDelta = inventoryDelta(inv);
  const share = shareDelta(market);
  const reference = market.usMetricsBasis === 'reference';

  return [
    {
      key: 'sales',
      label: '판매량',
      value: `${fmtFull(market.sales)}대`,
      note: periodLabel(market) || '누계 기간 불명',
      delta: { value: market.yoyPct, text: `전년 ${fmtPct(market.yoyPct)}` },
    },
    {
      key: 'share',
      label: '경쟁군 내 점유율',
      value: market.sharePct !== null ? `${market.sharePct}%` : '—',
      note: market.prevSharePct !== null ? `전년 ${market.prevSharePct}%` : '전년 데이터 없음',
      delta: { value: share, text: fmtPp(share) },
    },
    {
      key: 'inventory',
      label: '딜러 유통재고',
      value:
        inv?.days_supply !== null && inv?.days_supply !== undefined ? `${inv.days_supply}일` : '—',
      // 브랜드 단위라는 사실을 빼면 "이 차종의 재고"로 읽힌다.
      note: reference ? `${inventoryNote(market)} · 미국 참고치` : inventoryNote(market),
      delta: invDelta
        ? {
            value: invDelta.days,
            text: `직전 ${invDelta.days > 0 ? '+' : ''}${invDelta.days}일`,
            goodWhenUp: false,
          }
        : undefined,
    },
    {
      key: 'safety',
      label: 'NHTSA 리콜(미국)',
      value: saf ? `${saf.recall_count}건` : '—',
      note: saf
        ? `${saf.model_year}년형 · 불만 ${
            saf.complaint_count === null ? '조회 실패' : `${saf.complaint_count}건`
          }${reference ? ' · 미국 참고치' : ''}`
        : '미국 미판매',
    },
  ];
}

export default function KpiStrip({ market }: { market: CompetitionMarket }) {
  const signals = evaluateMarket(market);
  const byKey = new Map<SignalItemKey, SignalResult>(signals.map((s) => [s.key, s]));

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {buildTiles(market).map((t) => {
        const sig = byKey.get(t.key);
        return (
          <div key={t.key} className="rounded-md border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-1.5">
              <SignalDot signal={sig?.signal ?? null} size={8} title={sig?.hint} />
              <span className="text-xs text-muted-foreground">{t.label}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-lg font-semibold tabular-nums">{t.value}</span>
              {t.delta && (
                <DeltaText
                  value={t.delta.value}
                  text={t.delta.text}
                  goodWhenUp={t.delta.goodWhenUp ?? true}
                  className="text-xs font-medium"
                />
              )}
            </div>
            <div className="text-xs text-muted-foreground">{t.note}</div>
          </div>
        );
      })}
    </div>
  );
}
