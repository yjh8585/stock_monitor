/**
 * 원자재 가격 단위·통화·부가세 환산 — 원자재 화면 상단 「구리·열연 지역 비교」 차트용(2026-11-09).
 *
 * DB(market_series_daily)에는 발표처 원 단위 그대로 저장하고 여기서만 USD/t·부가세 제외로 맞춘다.
 * 사용자 선택(2026-11-09): 통일 단위 = 달러/톤 · 세금 포함 가격은 세금을 빼고 비교.
 *
 * 환율은 exchange_rates(USD·CNY → KRW 일봉)를 쓰고, 가격 날짜와 «같은 날 또는 그 이전 가장 가까운 날»
 * 환율을 붙인다. 그 이전 환율이 없는 앞쪽 가격은 버린다(가짜 값을 만들지 않는다).
 */
import type { SeriesPoint } from './seriesLive';

/** 1 미터톤 = 2,204.62262 lb */
export const LB_PER_MT = 2204.62262;
/** 1 미터톤 = 1.10231131 short ton */
export const SHORT_TON_PER_MT = 1.10231131;
/** 조달청 판매가는 「부가세 포함」 공시(한국 부가세 10%) */
export const KR_VAT = 1.1;
/** SHFE 등 중국 국내 선물가는 증치세 13% 포함 */
export const CN_VAT = 1.13;

// 화면에는 소수 2자리까지만 보이고 payload 를 줄이려고 소수 1자리로 반올림한다.
const round1 = (v: number) => Math.round(v * 10) / 10;

const DAY_MS = 86_400_000;

/**
 * prices 각 점에 같은 날 또는 그 이전 가장 가까운 날의 rate 를 붙여 fn(price, rate) 로 바꾼다. 둘 다 시간 오름차순.
 * maxLagDays 를 주면 붙일 rate 가 그보다 오래된 점은 버린다 — rate 쪽 수집이 끊겼을 때 옛 값을 몇 달씩
 * 붙여 그리지 않게(선이 끊겨야 눈에 띈다 · 2026-11-09 검토).
 */
export function joinAsOf(
  prices: SeriesPoint[],
  rates: SeriesPoint[],
  fn: (price: number, rate: number) => number,
  maxLagDays?: number
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let j = -1;
  for (const p of prices) {
    while (j + 1 < rates.length && rates[j + 1].time <= p.time) j++;
    if (j < 0) continue;
    if (
      maxLagDays !== undefined &&
      Date.parse(p.time) - Date.parse(rates[j].time) > maxLagDays * DAY_MS
    ) {
      continue;
    }
    out.push({ time: p.time, value: fn(p.value, rates[j].value) });
  }
  return out;
}

/** 중서부 프리미엄이 이보다 오래되면 미국 알루미늄 점을 그리지 않는다(연휴 포함 여유) */
export const PREMIUM_MAX_LAG_DAYS = 10;

/** COMEX 구리 USD/lb → USD/t */
export function comexCopperToUsdPerMt(points: SeriesPoint[]): SeriesPoint[] {
  return points.map((p) => ({ time: p.time, value: round1(p.value * LB_PER_MT) }));
}

/** 미국 HRC 선물 USD/short ton → USD/t */
export function usHrcToUsdPerMt(points: SeriesPoint[]): SeriesPoint[] {
  return points.map((p) => ({ time: p.time, value: round1(p.value * SHORT_TON_PER_MT) }));
}

/**
 * 미국 중서부 알루미늄 실거래가 USD/t = LME 현물(USD/t) + 중서부 프리미엄(USD/lb → ×2204.62262).
 * 관세·운송 웃돈은 프리미엄에만 들어 있어, COMEX 선물(ALI=F)만으로는 미국 가격이 LME 와 거의 같게 보인다
 * (2026-11-09 사용자 선택). 프리미엄은 LME 날짜에 «같은 날 또는 그 이전» 값을 붙인다.
 * 프리미엄이 가격의 큰 몫(2026-11 약 2,290 USD/t)이라, PREMIUM_MAX_LAG_DAYS 보다 오래된 프리미엄은 붙이지 않는다.
 */
export function usMidwestAluminumUsdPerMt(
  lmeUsdPerMt: SeriesPoint[],
  premiumUsdPerLb: SeriesPoint[]
): SeriesPoint[] {
  return joinAsOf(
    lmeUsdPerMt,
    premiumUsdPerLb,
    (lme, premium) => round1(lme + premium * LB_PER_MT),
    PREMIUM_MAX_LAG_DAYS
  );
}

/** 원/톤(부가세 포함) → USD/t(부가세 제외). usdKrw = 1달러당 원 */
export function krwVatToUsdPerMt(points: SeriesPoint[], usdKrw: SeriesPoint[]): SeriesPoint[] {
  return joinAsOf(points, usdKrw, (krw, rate) => round1(krw / KR_VAT / rate));
}

/** 위안/톤(증치세 포함) → USD/t(세금 제외). cnyKrw·usdKrw = 1위안·1달러당 원 */
export function cnyVatToUsdPerMt(
  points: SeriesPoint[],
  cnyKrw: SeriesPoint[],
  usdKrw: SeriesPoint[]
): SeriesPoint[] {
  // 두 환율을 «각각» 가격 날짜에 붙인다. CNY÷USD 비율을 먼저 만들면 CNY 날짜에 묶여,
  // USD 만 새로 들어온 날에도 옛 USD 를 쓴다(2026-11-09 Codex 검토로 발견).
  const krwPerMt = joinAsOf(points, cnyKrw, (cny, rate) => (cny / CN_VAT) * rate);
  return joinAsOf(krwPerMt, usdKrw, (krw, rate) => round1(krw / rate));
}
