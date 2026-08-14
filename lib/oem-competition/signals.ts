/**
 * 항목별 신호등 판정 — 순수 함수만 둔다(DB·React 의존 없음).
 *
 * 종합 판단(GREEN/YELLOW/RED)은 AI 가 서술 근거까지 종합해 내린 것이라 그대로 쓴다. 이 모듈은
 * "무엇 때문에 그런 판단인지"를 항목별로 쪼개 보여주기 위한 것이고, 근거가 수치 하나로
 * 명확한 항목만 다룬다. 그래서 종합 라벨을 여기서 다시 계산하지 않는다.
 *
 * 🔴 임계값은 이 파일이 정본이다. 화면 툴팁도 SIGNAL_THRESHOLDS 를 읽어 같은 값을 보여준다 —
 * 문구에 숫자를 다시 적으면 갈린다.
 */
import type { CompetitionMarket, InventoryPoint, SafetyPoint, ConsumerScore } from './types';
import { CONSUMER_AXES } from './types';

export type Signal = 'GREEN' | 'YELLOW' | 'RED';

/**
 * 🔴 재고·안전 라벨에 **(미국)** 을 박아 둔 것은 장식이 아니다. 두 지표는 미국 전용 소스(Cox·NHTSA)
 * 라서 인도·한국·중국·유럽 시장에는 값 자체가 없는데, 스코어보드는 차종당 한 줄로 요약하느라
 * 시장을 합친다 — 라벨이 없으면 "미국만의 판정"이 차종 전체 판정으로 읽힌다(사용자 지적 2026-08-14).
 */
export const SIGNAL_ITEMS = [
  { key: 'sales', label: '판매 증감' },
  { key: 'share', label: '점유율' },
  { key: 'inventory', label: '유통재고(미국)' },
  { key: 'safety', label: '안전성(미국)' },
  { key: 'consumer', label: '소비자 평가' },
] as const;

/** 미국 전용 지표 — 시장에 따라 판정 자격이 달라진다. */
const US_ONLY_ITEMS = new Set<SignalItemKey>(['inventory', 'safety']);

export type SignalItemKey = (typeof SIGNAL_ITEMS)[number]['key'];

/**
 * 판정 경계값. `green`/`red` 는 그 값을 **포함**한 쪽이 해당 등급이다.
 * `higherIsBetter=false` 인 항목(재고일수·리콜)은 값이 작을수록 좋다.
 */
export const SIGNAL_THRESHOLDS = {
  sales: { green: 5, red: -5, unit: '%', higherIsBetter: true },
  share: { green: 0.5, red: -1, unit: '%p', higherIsBetter: true },
  inventory: { green: 75, red: 110, unit: '일', higherIsBetter: false },
  safety: { green: 1, red: 5, unit: '건', higherIsBetter: false },
  consumer: { green: 0.5, red: -0.5, unit: '점', higherIsBetter: true },
} as const satisfies Record<
  SignalItemKey,
  { green: number; red: number; unit: string; higherIsBetter: boolean }
>;

/** 항목 1개의 판정 결과. value 가 null 이면 데이터가 없어 판정하지 않은 것(회색). */
export interface SignalResult {
  key: SignalItemKey;
  label: string;
  signal: Signal | null;
  value: number | null;
  /** 화면에 그대로 쓸 수 있는 표기(예: "-1.2%", "160일", "판정 불가"). */
  display: string;
  /** 왜 이 등급인지 — 툴팁 문구. 임계값을 상수에서 만들어 문구와 상수가 갈리지 않게 한다. */
  hint: string;
}

function classify(key: SignalItemKey, value: number | null): Signal | null {
  if (value === null || Number.isNaN(value)) return null;
  const t = SIGNAL_THRESHOLDS[key];
  if (t.higherIsBetter) {
    if (value >= t.green) return 'GREEN';
    return value < t.red ? 'RED' : 'YELLOW';
  }
  if (value <= t.green) return 'GREEN';
  return value >= t.red ? 'RED' : 'YELLOW';
}

function hintFor(key: SignalItemKey): string {
  const t = SIGNAL_THRESHOLDS[key];
  const fmt = (n: number) => `${n > 0 && t.higherIsBetter ? '+' : ''}${n}${t.unit}`;
  return t.higherIsBetter
    ? `🟢 ${fmt(t.green)} 이상 · 🟡 ${fmt(t.red)}~${fmt(t.green)} · 🔴 ${fmt(t.red)} 미만`
    : `🟢 ${fmt(t.green)} 이하 · 🟡 ${fmt(t.green)}~${fmt(t.red)} · 🔴 ${fmt(t.red)} 이상`;
}

/** 대상 차종의 재고일수. inventory[0] 이 대상이라는 가정에 기대지 않고 model 없는 항목을 찾는다. */
export function targetInventory(inventory: InventoryPoint[]): InventoryPoint | null {
  return inventory.find((i) => !i.model) ?? null;
}

export function targetSafety(safety: SafetyPoint[]): SafetyPoint | null {
  return safety.find((s) => !s.model) ?? null;
}

/**
 * 유통재고의 직전 공개월 대비 증감. Cox 는 이상치 월을 통째로 비우므로 "전월"이 아니라
 * **직전에 값이 공개된 달**과 비교한다(그래서 화면에 비교 대상 월을 함께 적는다).
 */
export function inventoryDelta(inv: InventoryPoint | null): { days: number; pct: number } | null {
  const prev = inv?.prevDaysSupply;
  if (!inv || inv.days_supply === null || prev === null || prev === undefined || prev <= 0) {
    return null;
  }
  const days = inv.days_supply - prev;
  return { days, pct: round1((days * 100) / prev) };
}

/** 경쟁군 내 점유율의 전년 대비 변화(%p). 둘 중 하나라도 없으면 비교 불가. */
export function shareDelta(market: Pick<CompetitionMarket, 'sharePct' | 'prevSharePct'>) {
  return market.sharePct !== null && market.prevSharePct !== null
    ? round1(market.sharePct - market.prevSharePct)
    : null;
}

/** 5축 평균. 축이 늘어도 CONSUMER_AXES 만 고치면 따라온다. */
export function consumerAverage(score: ConsumerScore): number {
  const sum = CONSUMER_AXES.reduce((acc, a) => acc + score[a.key], 0);
  return sum / CONSUMER_AXES.length;
}

/**
 * 소비자 평가 격차 — 대상 5축 평균 − 경쟁차종들의 5축 평균.
 * 경쟁이 없으면 비교 자체가 불가능하므로 null.
 */
export function consumerGap(scores: ConsumerScore[]): number | null {
  const target = scores.find((s) => s.is_target);
  const rivals = scores.filter((s) => !s.is_target);
  if (!target || rivals.length === 0) return null;
  const rivalAvg = rivals.reduce((acc, r) => acc + consumerAverage(r), 0) / rivals.length;
  return consumerAverage(target) - rivalAvg;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 미국 지표의 판정 자격을 적용한다.
 *
 * - `reference`(글로벌 시장에 붙인 미국 참고치): 값은 그대로 보여 주되 **등급을 매기지 않는다**
 *   (사용자 결정 2026-08-14). 포르쉐 911 은 시장이 글로벌 하나뿐인데 Cox·NHTSA 는 미국 것이라,
 *   그대로 등급을 주면 미국 수치가 글로벌 평가로 둔갑한다.
 * - Cox 이상치 제외: 수치가 없는 게 아니라 **업계 평균 2배를 넘어 Cox 가 감춘 것**이라 RED 다.
 */
function applyUsMetricRules(
  result: SignalResult,
  market: CompetitionMarket,
  inv: InventoryPoint | null
): SignalResult {
  if (result.key === 'inventory' && inv?.outlierExcluded) {
    const from = inv.outlierMonth ? `${String(inv.outlierMonth).slice(4, 6)}월부터 ` : '';
    return {
      ...result,
      signal: market.usMetricsBasis === 'reference' ? null : 'RED',
      display: '평균 2배 초과',
      hint: `Cox 가 ${from}수치를 공개하지 않았다 — 업계 평균의 2배를 넘는 브랜드는 값이 실리지 않는다(= 재고 심각).`,
    };
  }
  if (US_ONLY_ITEMS.has(result.key) && market.usMetricsBasis === 'reference') {
    return {
      ...result,
      signal: null,
      display: result.value === null ? '데이터 없음' : `${result.display} (미국 참고)`,
      hint: '글로벌 시장이라 미국 전용 지표는 참고치로만 표시하고 등급을 매기지 않는다.',
    };
  }
  return result;
}

/** 한 시장의 항목별 신호등 5개. 표시 순서는 SIGNAL_ITEMS 순서를 따른다. */
export function evaluateMarket(market: CompetitionMarket): SignalResult[] {
  const inv = targetInventory(market.inventory);
  const saf = targetSafety(market.safety);
  const gap = consumerGap(market.consumerScores);

  const values: Record<SignalItemKey, number | null> = {
    sales: market.yoyPct,
    share: shareDelta(market),
    inventory: inv?.days_supply ?? null,
    safety: saf?.recall_count ?? null,
    consumer: gap === null ? null : round1(gap),
  };

  const displays: Record<SignalItemKey, (v: number) => string> = {
    sales: (v) => `${v > 0 ? '+' : ''}${v}%`,
    share: (v) => `${v > 0 ? '+' : ''}${v}%p`,
    inventory: (v) => `${v}일`,
    safety: (v) => `리콜 ${v}건`,
    consumer: (v) => `${v > 0 ? '+' : ''}${v}점`,
  };

  return SIGNAL_ITEMS.map(({ key, label }) => {
    const value = values[key];
    const base: SignalResult = {
      key,
      label,
      signal: classify(key, value),
      value,
      display: value === null ? '데이터 없음' : displays[key](value),
      hint: hintFor(key),
    };
    return applyUsMetricRules(base, market, inv);
  });
}

/**
 * 차종 하나의 대표 신호등 — 시장이 여럿이면 **가장 나쁜 등급**을 쓴다.
 * 스코어보드는 한 줄에 한 차종이므로 요약이 필요하고, 위험 신호를 평균으로 희석하지 않는다.
 */
export function worstSignal(perMarket: SignalResult[][], key: SignalItemKey): Signal | null {
  const rank: Record<Signal, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
  let worst: Signal | null = null;
  for (const results of perMarket) {
    const s = results.find((r) => r.key === key)?.signal;
    if (!s) continue;
    if (worst === null || rank[s] > rank[worst]) worst = s;
  }
  return worst;
}
