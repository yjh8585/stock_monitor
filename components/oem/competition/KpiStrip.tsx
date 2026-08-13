'use client';

/**
 * 시장 하나의 핵심 숫자 4개 + 항목별 신호등.
 *
 * 차트를 보기 전에 "지금 어떤 상태인가"를 숫자로 먼저 잡아 준다. 차트는 추세를, 여기는 수준을
 * 담당한다. 신호등을 숫자 옆에 붙여 두면 스코어보드로 되돌아가지 않아도 등급을 알 수 있다.
 */
import { evaluateMarket, targetInventory, targetSafety } from '@/lib/oem-competition/signals';
import type { SignalItemKey, SignalResult } from '@/lib/oem-competition/signals';
import type { CompetitionMarket } from '@/lib/oem-competition/types';
import { fmtFull } from '@/components/oem/helpers';
import { periodLabel, SignalDot } from './shared';

interface Tile {
  key: SignalItemKey;
  label: string;
  value: string;
  /** 값 아래 작은 글씨 — 무엇과 비교한 값인지. 숫자만 있으면 해석이 안 된다. */
  note: string;
}

function buildTiles(market: CompetitionMarket): Tile[] {
  const inv = targetInventory(market.inventory);
  const saf = targetSafety(market.safety);
  const shareNote =
    market.prevSharePct !== null ? `전년 ${market.prevSharePct}%` : '전년 데이터 없음';

  return [
    {
      key: 'sales',
      label: '판매량',
      value: `${fmtFull(market.sales)}대`,
      note: periodLabel(market) || '누계 기간 불명',
    },
    {
      key: 'share',
      label: '경쟁군 내 점유율',
      value: market.sharePct !== null ? `${market.sharePct}%` : '—',
      note: shareNote,
    },
    {
      key: 'inventory',
      label: '재고일수',
      value: inv ? `${inv.days_supply}일` : '—',
      // 브랜드 단위라는 사실을 빼면 "이 차종의 재고"로 읽힌다.
      note: inv ? `${inv.brand} 브랜드 · 미국` : 'Cox 미제공',
    },
    {
      key: 'safety',
      label: 'NHTSA 리콜',
      value: saf ? `${saf.recall_count}건` : '—',
      note: saf
        ? `${saf.model_year}년형 · 불만 ${
            saf.complaint_count === null ? '조회 실패' : `${saf.complaint_count}건`
          }`
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
            <div className="text-lg font-semibold tabular-nums mt-0.5">{t.value}</div>
            <div className="text-xs text-muted-foreground">{t.note}</div>
          </div>
        );
      })}
    </div>
  );
}
