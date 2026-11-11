/**
 * 가이던스 카드 신호등(A10 · 결정 R3 · 2026-11-11 사용자 지시) — 빨강·노랑·초록·회색 + 이유 한 줄.
 *
 * 사용자 원문: 「연초 대비 하향된 목표를 최근 가이던스에서 계속 사용하면 유지 라고 뜨던데 이런거는 부정적인 거잖아 사실.
 * … 매출 성장세가 더디거나 이익률이 낮아지는 거는 다 상황이 부정적인 거지.」
 *
 * 판정 순서(앞에서 걸리면 멈춘다):
 *   1. 철회 → 빨강
 *   2. 방향을 따지지 않는 지표(투자·특별 요인 등) → 회색
 *   3. 지금 전망 < 그 FY 첫 전망(범위는 중간값) → 빨강 — 최근 방향이 「유지」여도
 *   4. 전년 실적과 견줄 재료가 있으면(매출 성장률·매출 금액·영업이익률·회사 조정 이익률)
 *        매출 감소 · 이익률 목표 < 전년 → 빨강 / 개선 폭이 작음 → 노랑 / 뚜렷한 개선 → 초록
 *   5. 지금 전망 > 첫 전망 → 초록
 *   6. 그 밖 → 회색(비교 대상 없음)
 * 기준 숫자는 GUIDANCE_SIGNAL_THRESHOLDS 한 곳에만 둔다(oem-competition/signals.ts 의 SIGNAL_THRESHOLDS 와 같은 꼴).
 */
import {
  ADJUSTED_OPERATING_METRICS,
  NEUTRAL_GUIDANCE_METRICS,
  type GuidanceCard,
  type GuidanceRowTs,
} from './ir';
import type { CustomerEarningsPoint } from './types';
import { rangeText, toUnit } from './format';

export const GUIDANCE_SIGNAL_THRESHOLDS = {
  /** 매출 성장(%)이 이 값 이하(0 이상)면 노랑 — 넘으면 초록. */
  revenueGrowthYellowMaxPct: 3,
  /** 영업이익률 개선(%p)이 이 값 미만(0 이상)이면 노랑 — 이상이면 초록. */
  marginDeltaGreenPp: 0.5,
  /** 첫 전망과 지금 전망이 이만큼(상대) 안쪽이면 같은 값으로 본다 — 단위 환산의 부동소수 오차용. */
  sameValueTolerance: 1e-6,
} as const;

export type SignalColor = 'red' | 'yellow' | 'green' | 'gray';

/** 신호 이름 — 상세 카드·요약 표가 함께 쓴다. */
export const SIGNAL_LABEL: Record<SignalColor, string> = {
  red: '부정',
  yellow: '주의',
  green: '긍정',
  gray: '판단 보류',
};

export interface GuidanceSignal {
  color: SignalColor;
  reason: string;
}

/** 매출 금액 지표 — 전년 실적 매출과 견준다. 조정 매출도 같은 문턱으로(2026-11-11 사용자 선택). */
const REVENUE_AMOUNT = new Set(['revenue', 'adjusted_sales']);
/**
 * 회사 조정 이익률 전망 → 전년 실적에서 견줄 조정 영업이익 지표(`ir.ts` ADJUSTED_OPERATING_METRICS 의 코드).
 * 같은 회사가 법정 영업이익도 내므로 법정 이익률(operating_margin_pct)과 견주면 정의가 갈린다 — 조정 ÷ 매출로 잰다.
 */
const ADJUSTED_MARGIN_BASE: Record<string, (typeof ADJUSTED_OPERATING_METRICS)[number]> = {
  aoi_margin: 'aoi',
  operating_margin_adjusted: 'operating_result_bsi',
};

/** 이익률 전망과 견줄 전년 이익률(%)과 이유 문구의 이름. 견줄 재료가 없으면 null. */
function priorMarginFor(
  metric: string,
  prior: CustomerEarningsPoint | null
): { pct: number; label: string } | null {
  if (!prior) return null;
  // 장부상 이익률 전망 — 전년 점의 영업이익이 회사 «조정» 값으로 채워졌으면 정의가 갈려 견주지 않는다.
  if (metric === 'operating_margin')
    return prior.operating_margin_pct == null ||
      prior.origin?.operating_income.source === 'company_adjusted'
      ? null
      : { pct: prior.operating_margin_pct, label: '영업이익률' };
  const base = ADJUSTED_MARGIN_BASE[metric];
  if (!base || prior.revenue_bn == null || prior.revenue_bn <= 0) return null;
  const a = prior.adjusted?.find((x) => x.metric === base);
  return a ? { pct: (a.value_bn / prior.revenue_bn) * 100, label: `${a.name} 이익률` } : null;
}

/** 범위 중간값(한쪽만 있으면 그 값). 숫자가 없으면 null. */
export function midOf(r: Pick<GuidanceRowTs, 'low' | 'high'>): number | null {
  if (r.low != null && r.high != null) return (r.low + r.high) / 2;
  return r.low ?? r.high ?? null;
}

/**
 * 「한 자릿수」 문구 전망을 % 범위로 읽는다 — 시장에서 흔히 쓰는 뜻(낮은 1~3 · 중간 4~6 · 높은 7~9).
 * 감소·하락 낱말이 붙으면 음수. 해당 문구가 아니면 null(그대로 판단 보류).
 * SHORTCUT: 영어 세 표현만 — 다른 문구(「flat」·「double digit」 등)가 들어오면 여기에 더한다.
 */
export function singleDigitRange(text: string | null): { low: number; high: number } | null {
  const m = text && /\b(low|mid|high)[-\s]+single[-\s]+digits?\b/i.exec(text);
  if (!m) return null;
  const base = { low: [1, 3], mid: [4, 6], high: [7, 9] }[
    m[1].toLowerCase() as 'low' | 'mid' | 'high'
  ];
  // 「lower end of」·「down to」 같은 수식어는 감소가 아니다(범위의 아래쪽) — 감소 낱말에서 뺀다.
  const neg = /\b(decrease|decline|lower(?!\s+end)|down(?!\s+to))\b/i.test(text!);
  return neg ? { low: -base[1], high: -base[0] } : { low: base[0], high: base[1] };
}

/** 판정에 쓸 숫자 — 범위 숫자가 있으면 그것 · 없으면 「한 자릿수」 문구를 % 로 읽은 것. */
function numericOf(r: GuidanceRowTs): {
  mid: number;
  unit: string;
  low: number | null;
  high: number | null;
  fromText: boolean;
} | null {
  const mid = midOf(r);
  if (mid != null) return { mid, unit: r.unit, low: r.low, high: r.high, fromText: false };
  const t = singleDigitRange(r.value_text);
  return t ? { mid: (t.low + t.high) / 2, unit: 'percent', ...t, fromText: true } : null;
}

const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtPp = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%p`;

/** 문구 전망(숫자 없음)의 방향 — 그 FY 이력의 상향·하향 수로 가른다. */
function textTrend(history: GuidanceRowTs[]): number {
  return history.reduce(
    (n, r) => n + (r.direction === 'raised' ? 1 : r.direction === 'lowered' ? -1 : 0),
    0
  );
}

/** 성장률·이익률 차이 → 색. 0 미만 빨강 · 문턱 이하/미만 노랑 · 그 위 초록. */
function grade(value: number, yellowUpTo: number, inclusive: boolean): SignalColor {
  if (value < 0) return 'red';
  if (inclusive ? value <= yellowUpTo : value < yellowUpTo) return 'yellow';
  return 'green';
}

/**
 * 카드 한 장의 신호.
 * @param prior 전년(카드 FY − 1) 연간 실적 점 — 상세 화면의 실적(회사 공시 우선). 없으면 null.
 * @param earningsCurrency prior 의 통화 — 매출 금액은 카드 통화와 같을 때만 견준다.
 */
export function guidanceSignal(
  card: Pick<GuidanceCard, 'metric' | 'current' | 'history' | 'withdrawn_at' | 'currency'>,
  prior: CustomerEarningsPoint | null,
  earningsCurrency: string | null
): GuidanceSignal {
  const T = GUIDANCE_SIGNAL_THRESHOLDS;
  if (card.withdrawn_at) return { color: 'red', reason: `전망 철회(${card.withdrawn_at})` };
  if (NEUTRAL_GUIDANCE_METRICS.has(card.metric))
    return { color: 'gray', reason: '높낮이로 좋고 나쁨을 가르지 않는 지표(투자·특별 요인 등)' };

  const cur = card.current;
  const first = card.history[0] ?? cur;
  const curN = numericOf(cur);
  const firstN = numericOf(first);
  const curMid = curN?.mid ?? null;
  const curUnit = curN?.unit ?? cur.unit;
  // 단위를 바꿀 수 없으면(대수 ↔ % 등) 첫 전망과 견주지 않는다 — toUnit 은 그때 값을 그대로 돌려준다.
  const firstConv = firstN == null ? null : toUnit(firstN.mid, firstN.unit, curUnit);
  const firstInCurUnit = firstConv && firstConv.unit === curUnit ? firstConv.value : null;
  const tol = Math.abs(firstInCurUnit ?? 0) * T.sameValueTolerance;
  // 문구를 % 로 읽었으면 이유 끝에 밝힌다(지어낸 숫자로 보이지 않게).
  const note = curN?.fromText
    ? ` · 「${cur.value_text}」를 약 ${rangeText(curN.low, curN.high, 'percent')}로 해석`
    : '';

  // 3. 그 FY 첫 전망보다 낮아졌나 — 최근 방향이 「유지」여도 빨강.
  if (curMid != null && firstInCurUnit != null && firstN) {
    if (curMid - firstInCurUnit < -tol)
      return {
        color: 'red',
        reason: `그해 첫 전망(${first.published_at} ${
          firstN.fromText
            ? `「${first.value_text}」`
            : rangeText(first.low, first.high, first.unit, first.currency ?? card.currency)
        })보다 낮아짐${note}`,
      };
  } else if (curMid == null && textTrend(card.history) < 0) {
    return { color: 'red', reason: '그해 첫 전망보다 하향(원문 문구 전망)' };
  }

  // 4. 전년 실적과 견주기.
  if (curMid != null) {
    if (card.metric === 'revenue_growth' && curUnit === 'percent') {
      const c = grade(curMid, T.revenueGrowthYellowMaxPct, true);
      return {
        color: c,
        reason:
          (c === 'red'
            ? `매출 감소 전망(${fmtPct(curMid)})`
            : c === 'yellow'
              ? `매출 성장 ${fmtPct(curMid)} — ${T.revenueGrowthYellowMaxPct}% 이하로 더딤`
              : `매출 성장 ${fmtPct(curMid)}`) + note,
      };
    }
    if (
      REVENUE_AMOUNT.has(card.metric) &&
      prior?.revenue_bn != null &&
      prior.revenue_bn > 0 &&
      (card.currency == null || card.currency === earningsCurrency)
    ) {
      const targetBn = toUnit(curMid, curUnit, 'billion');
      if (targetBn.unit === 'billion') {
        const growth = (targetBn.value / prior.revenue_bn - 1) * 100;
        const c = grade(growth, T.revenueGrowthYellowMaxPct, true);
        return {
          color: c,
          reason: `전년(${prior.fiscal_year}) 매출 대비 ${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%${
            c === 'red' ? ' — 매출 감소 전망' : c === 'yellow' ? ' — 성장 더딤' : ''
          }`,
        };
      }
    }
    const pm = curUnit === 'percent' ? priorMarginFor(card.metric, prior) : null;
    if (pm && prior) {
      const delta = curMid - pm.pct;
      const c = grade(delta, T.marginDeltaGreenPp, false);
      return {
        color: c,
        reason: `전년(${prior.fiscal_year}) ${pm.label} ${fmtPct(pm.pct)} 대비 ${fmtPp(delta)}${
          c === 'red' ? ' — 이익률 낮아짐' : c === 'yellow' ? ' — 개선 폭 작음' : ''
        }${note}`,
      };
    }
  }

  // 5. 첫 전망보다 올랐나.
  if (curMid != null && firstInCurUnit != null && curMid - firstInCurUnit > tol)
    return { color: 'green', reason: `그해 첫 전망보다 상향${note}` };
  if (curMid == null && textTrend(card.history) > 0)
    return { color: 'green', reason: '그해 첫 전망보다 상향(원문 문구 전망)' };

  // 회색 이유는 사실대로 — 「전년과 견주는 지표인데 재료가 없다」와 「애초에 전년과 견주지 않는 지표」를 가른다.
  const comparesPrior =
    card.metric === 'revenue_growth' ||
    REVENUE_AMOUNT.has(card.metric) ||
    card.metric === 'operating_margin' ||
    card.metric in ADJUSTED_MARGIN_BASE;
  return {
    color: 'gray',
    reason:
      curMid == null
        ? '원문이 숫자 없는 문구라 견줄 수 없음'
        : `비교 대상 없음 — 첫 전망 그대로 · ${
            comparesPrior
              ? '전년 실적과 견줄 수 없음(실적 없음 또는 통화·정의가 다름)'
              : '전년 실적과는 매출·이익률만 견줌'
          }${note}`,
  };
}
