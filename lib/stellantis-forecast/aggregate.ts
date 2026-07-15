/**
 * 스텔란티스 북미 매출 전망(/management/stellantis) 순수 집계 빌더.
 *
 * 핵심 항등식: **출하 − 소매 = 딜러 재고 증감**. 세 축을 같은 잣대 위에 올려
 * "출하는 늘었는데 소매가 안 늘고 재고가 쌓이는가"를 판정하는 게 이 모듈의 목적이다.
 *
 * 스코프 정합 (틀리면 전부 무의미해진다):
 *  - 출하는 Stellantis IR의 **North America 세그먼트**(미국+캐나다+멕시코, **마세라티 제외** —
 *    마세라티는 별도 세그먼트). 따라서 소매도 3개국 합산 + 마세라티 제외로 맞춘다.
 *  - MarkLines는 **캐나다가 한 달 늦게** 들어온다 → 3개국이 다 채워진 분기까지만 쓴다
 *    (`lastCompleteQuarter`). 안 그러면 소매가 과소집계돼 재고 축적을 과대평가한다.
 */
import type {
  CoxInventoryRow,
  Diagnosis,
  ForecastPoint,
  ForecastScenario,
  ForecastSeries,
  GapPoint,
  LagCandidate,
  LagResult,
  RetailMonthRow,
  RevenueMonthRow,
  RevenueVsRetailPoint,
  ShipmentRow,
  UnitRevenuePoint,
  UnitRevenueSeries,
} from './types';

/** IR North America 세그먼트가 제외하는 마세라티 모델 (MarkLines 라벨 기준). */
export const MASERATI_MODELS: ReadonlySet<string> = new Set([
  'Grecale',
  'Maserati Levante',
  'Maserati GranTurismo',
  'Ghibli',
  'MC20',
  'Maserati Quattroporte',
  'SF90 Stradale', // 페라리 — MarkLines가 2020년 FCA에 잘못 붙여 놓은 7대. 같이 배제.
]);

/** IR North America 세그먼트 구성 국가 (MarkLines country 라벨). */
export const NA_COUNTRIES: readonly string[] = ['USA', 'Canada', 'Mexico'];

/** 스텔란티스 브랜드 (Cox 차트에 실리는 것만 — Fiat·Alfa Romeo는 물량 미달로 미수록). */
export const STELLANTIS_COX_BRANDS: readonly string[] = ['Jeep', 'Ram', 'Dodge', 'Chrysler'];

/** Cox가 이상치로 제외하는 기준 — 업계 평균 대비 배수. */
export const COX_OUTLIER_MULTIPLE = 2;

/** 시차 탐색 범위(개월). 자사 매출 53개월이라 ±6이면 lag별 표본 35~41로 충분. */
export const MAX_LAG_MONTHS = 6;

/** 상관을 신뢰할 최소 표본 수. 이보다 적으면 시차를 채택하지 않는다. */
export const MIN_LAG_SAMPLES = 12;

/** 원단위 변동계수가 이 값을 넘으면 전망 신뢰도 경고. */
export const UNIT_REVENUE_CV_WARN = 0.25;

/** 재고 과잉분을 해소한다고 가정하는 분기 수 (시나리오 ②). */
const NORMALIZE_OVER_QUARTERS = 2;

/** 추세 계산에 쓰는 최근 분기 수. */
const TREND_WINDOW_QUARTERS = 4;

/** 전망 분기 수. */
const FORECAST_QUARTERS = 4;

/** 1억원 = 10^8원 — 원단위(대당 원) 환산용. */
const EOK_TO_WON = 100_000_000;

// ---------------------------------------------------------------------------
// 기간 헬퍼
// ---------------------------------------------------------------------------

/** 202503 → '2025-Q1' */
export function quarterOfYearMonth(yearMonth: number): string {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** '2025-Q1' → '25Q1' (기존 OEM 차트 라벨 규칙과 동일) */
export function quarterLabel(yearPeriod: string): string {
  const [year, q] = yearPeriod.split('-');
  return `${year.slice(2)}${q}`;
}

/** 202503 → '25.03' */
export function monthLabel(yearMonth: number): string {
  return `${String(Math.floor(yearMonth / 100)).slice(2)}.${String(yearMonth % 100).padStart(2, '0')}`;
}

/** '2025-Q1' → 분기 일련번호(정렬·시차 계산용). 2025Q1 → 8101 */
function quarterIndex(yearPeriod: string): number {
  const [year, q] = yearPeriod.split('-');
  return Number(year) * 4 + Number(q.slice(1)) - 1;
}

/** 분기 일련번호 → '2025-Q1' */
function quarterFromIndex(index: number): string {
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

/** 202503에 n개월 더하기 → 202506 */
function addMonths(yearMonth: number, n: number): number {
  const total = Math.floor(yearMonth / 100) * 12 + ((yearMonth % 100) - 1) + n;
  return Math.floor(total / 12) * 100 + (total % 12) + 1;
}

// ---------------------------------------------------------------------------
// 소매 (MarkLines) — 국가 지연 처리가 핵심
// ---------------------------------------------------------------------------

function isNaScopeRow(row: RetailMonthRow): boolean {
  return NA_COUNTRIES.includes(row.country) && !MASERATI_MODELS.has(row.model);
}

/**
 * 3개국이 **모두** 데이터를 가진 마지막 분기.
 *
 * MarkLines는 캐나다가 한 달 늦게 들어온다(2026-07-15 기준 USA·Mexico는 202606,
 * Canada는 202605). 이걸 무시하고 합산하면 최신 분기 소매가 과소집계돼
 * `출하 − 소매` 갭이 부풀고 **재고 축적을 과대평가**한다 — 이 페이지가 판정하려는 바로 그것이라 치명적.
 *
 * 국가별 최신 월의 min()을 취하고, 그 월이 속한 분기가 **3개월 다 찼을 때만** 완전 분기로 본다.
 */
export function lastCompleteQuarter(rows: RetailMonthRow[]): string | null {
  const latestByCountry = new Map<string, number>();
  for (const row of rows) {
    if (!NA_COUNTRIES.includes(row.country)) continue;
    const prev = latestByCountry.get(row.country);
    if (prev === undefined || row.year_month > prev)
      latestByCountry.set(row.country, row.year_month);
  }
  // 한 나라라도 데이터가 없으면 북미 합산 자체가 성립하지 않는다.
  if (latestByCountry.size < NA_COUNTRIES.length) return null;

  const commonLatest = Math.min(...latestByCountry.values());
  const month = commonLatest % 100;
  const isQuarterEnd = month % 3 === 0;
  const quarter = quarterOfYearMonth(commonLatest);
  if (isQuarterEnd) return quarter;
  // 분기 중간까지만 찼으면 그 직전 분기가 마지막 완전 분기.
  return quarterFromIndex(quarterIndex(quarter) - 1);
}

/** 완전 분기까지의 북미 소매 합계 (마세라티 제외). */
export function buildNaRetailQuarters(
  rows: RetailMonthRow[],
  cutoffQuarter: string | null
): Map<string, number> {
  const out = new Map<string, number>();
  if (!cutoffQuarter) return out;
  const cutoff = quarterIndex(cutoffQuarter);
  for (const row of rows) {
    if (!isNaScopeRow(row)) continue;
    const quarter = quarterOfYearMonth(row.year_month);
    if (quarterIndex(quarter) > cutoff) continue;
    out.set(quarter, (out.get(quarter) ?? 0) + row.sales);
  }
  return out;
}

/** 월별 북미 소매 합계 (마세라티 제외) — 시차 탐지용. 국가 지연은 여기선 무시(월 단위 상관이라). */
export function buildNaRetailMonths(rows: RetailMonthRow[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of rows) {
    if (!isNaScopeRow(row)) continue;
    out.set(row.year_month, (out.get(row.year_month) ?? 0) + row.sales);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 차트 1 — 출하 vs 소매 vs 재고 증감
// ---------------------------------------------------------------------------

/**
 * 출하·소매가 **둘 다 있는** 분기만 갭을 만든다.
 *
 * 최신 분기 출하는 H1/FY 보도자료가 나올 때까지 비어 있는 게 정상이므로(Q2/Q4 차분 도출),
 * 한쪽만 있는 분기를 0으로 채우면 가짜 갭이 생긴다. 반드시 교집합만 쓴다.
 */
export function buildGapPoints(
  shipments: ShipmentRow[],
  retailByQuarter: Map<string, number>
): GapPoint[] {
  const points: GapPoint[] = [];
  const sorted = [...shipments].sort(
    (a, b) => quarterIndex(a.year_period) - quarterIndex(b.year_period)
  );
  let cum = 0;
  for (const ship of sorted) {
    const retail = retailByQuarter.get(ship.year_period);
    if (retail === undefined) continue;
    const gap = ship.shipments_units - retail;
    cum += gap;
    points.push({
      yearPeriod: ship.year_period,
      label: quarterLabel(ship.year_period),
      shipments: ship.shipments_units,
      retail,
      gap,
      cumGap: cum,
      isDerived: ship.is_derived,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// 시차 탐지
// ---------------------------------------------------------------------------

/**
 * YoY 증감률 계열로 변환.
 *
 * 원계열(수준) 상관을 쓰면 둘 다 우상향·계절성만 있어도 r이 0.9씩 나온다(허위 상관).
 * 전년 동월 대비 증감률은 추세·계절성을 함께 제거해 "같이 흔들리는가"만 남긴다.
 */
export function toYoySeries(series: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [yearMonth, value] of series) {
    const prev = series.get(addMonths(yearMonth, -12));
    if (prev === undefined || prev === 0) continue;
    out.set(yearMonth, ((value - prev) / prev) * 100);
  }
  return out;
}

/** 피어슨 상관계수. 표본이 2 미만이거나 분산이 0이면 null. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

/**
 * 자사 매출이 스텔란티스 소매보다 몇 달 **선행**하는지 탐지.
 *
 * lag > 0 = 자사 매출이 선행(부품을 먼저 납품하고 나중에 차가 팔린다 — 사업 구조상 자연스러움).
 * 매칭 규칙: 자사 매출[t] ↔ 소매[t + lag].
 *
 * 추정하지 않고 데이터가 답하게 한다(사용자 결정 2026-07-15). 후보 전체를 함께 반환해
 * 화면에서 근거를 볼 수 있게 한다 — 블랙박스 금지.
 */
export function detectLag(
  revenueMonthly: Map<number, number>,
  retailMonthly: Map<number, number>,
  maxLag: number = MAX_LAG_MONTHS
): LagResult | null {
  const revYoy = toYoySeries(revenueMonthly);
  const retailYoy = toYoySeries(retailMonthly);

  const candidates: LagCandidate[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [yearMonth, revValue] of revYoy) {
      const retailValue = retailYoy.get(addMonths(yearMonth, lag));
      if (retailValue === undefined) continue;
      xs.push(revValue);
      ys.push(retailValue);
    }
    const r = pearson(xs, ys);
    if (r === null || xs.length < MIN_LAG_SAMPLES) continue;
    candidates.push({ lagMonths: lag, r, n: xs.length });
  }
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
  return { lagMonths: best.lagMonths, r: best.r, n: best.n, candidates };
}

// ---------------------------------------------------------------------------
// 차트 2 — 자사 매출 vs 소매 (시차 정렬)
// ---------------------------------------------------------------------------

export function buildRevenueVsRetail(
  revenue: RevenueMonthRow[],
  retailMonthly: Map<number, number>,
  lagMonths: number
): RevenueVsRetailPoint[] {
  return [...revenue]
    .sort((a, b) => a.year_month - b.year_month)
    .map((row) => ({
      yearMonth: row.year_month,
      label: monthLabel(row.year_month),
      revenueEok: row.revenueEok,
      retailShifted: retailMonthly.get(addMonths(row.year_month, lagMonths)) ?? null,
    }));
}

// ---------------------------------------------------------------------------
// 차트 3 — 대당 매출 원단위
// ---------------------------------------------------------------------------

/** 자사 월별 매출 → 분기 합계 (억원). */
export function revenueByQuarter(revenue: RevenueMonthRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of revenue) {
    const quarter = quarterOfYearMonth(row.year_month);
    out.set(quarter, (out.get(quarter) ?? 0) + row.revenueEok);
  }
  return out;
}

/**
 * 대당 매출 = 자사 매출(억원) ÷ 북미 출하(대).
 *
 * **소매가 아니라 출하 기준**인 이유: 부품 매출은 딜러 재고를 거치지 않고 OEM의 생산·출하에
 * 연동된다. 지리 단위도 북미로 일치한다.
 *
 * 시차는 분기 단위로 반올림해 적용한다(출하가 분기 데이터라 월 단위 정밀도가 의미 없음).
 */
export function buildUnitRevenue(
  revenueQuarters: Map<string, number>,
  shipments: ShipmentRow[],
  lagMonths: number
): UnitRevenueSeries {
  const lagQuarters = Math.round(lagMonths / 3);
  const points: UnitRevenuePoint[] = [];
  for (const ship of [...shipments].sort(
    (a, b) => quarterIndex(a.year_period) - quarterIndex(b.year_period)
  )) {
    if (ship.shipments_units <= 0) continue;
    // 자사 매출[t] ↔ 출하[t + lag] → 출하 분기에 대응하는 매출 분기는 t = 출하분기 − lag.
    const revenueQuarter = quarterFromIndex(quarterIndex(ship.year_period) - lagQuarters);
    const revenueEok = revenueQuarters.get(revenueQuarter);
    if (revenueEok === undefined) continue;
    points.push({
      yearPeriod: ship.year_period,
      label: quarterLabel(ship.year_period),
      wonPerUnit: (revenueEok * EOK_TO_WON) / ship.shipments_units,
    });
  }
  if (points.length === 0) return { points, mean: 0, cv: 0 };

  const values = points.map((p) => p.wonPerUnit);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const cv = mean === 0 ? 0 : Math.sqrt(variance) / mean;
  return { points, mean, cv };
}

// ---------------------------------------------------------------------------
// 진단 신호
// ---------------------------------------------------------------------------

/** 최근 n분기 gap 합계. */
function recentGapSum(gap: GapPoint[], n: number): number {
  return gap.slice(-n).reduce((acc, p) => acc + p.gap, 0);
}

function yoyOf(points: GapPoint[], pick: (p: GapPoint) => number): number | null {
  if (points.length < 5) return null;
  const latest = points[points.length - 1];
  const prior = points[points.length - 5]; // 4분기 전 = 전년 동기
  const prev = pick(prior);
  if (prev === 0) return null;
  return ((pick(latest) - prev) / prev) * 100;
}

/**
 * 3색 진단.
 *
 * 사용자 정의 시나리오: "출하와 자사 매출은 크게 늘었는데 소매가 안 늘고 재고가 쌓이면
 * → 향후 감산 → 자사 매출 악영향". 이를 그대로 판정식으로 옮긴다.
 *
 * Cox 재고일수는 **독립 교차검증**으로 쓴다. 계산 갭과 실측이 같은 방향이면 신뢰도가 올라가고,
 * 어긋나면 그 사실 자체를 근거에 적어 사람이 판단하게 한다.
 */
export function diagnose(gap: GapPoint[], cox: CoxInventoryRow[]): Diagnosis {
  const reasons: string[] = [];
  if (gap.length === 0) {
    return {
      level: 'yellow',
      headline: '데이터 부족',
      reasons: ['출하·소매가 모두 있는 분기가 없습니다.'],
    };
  }

  const latest = gap[gap.length - 1];
  const shipYoy = yoyOf(gap, (p) => p.shipments);
  const retailYoy = yoyOf(gap, (p) => p.retail);
  const recentGap = recentGapSum(gap, TREND_WINDOW_QUARTERS);

  reasons.push(
    `${latest.label} 출하 ${latest.shipments.toLocaleString('ko-KR')}대 vs 소매 ${latest.retail.toLocaleString('ko-KR')}대 → 갭 ${latest.gap >= 0 ? '+' : ''}${latest.gap.toLocaleString('ko-KR')}대`
  );
  if (shipYoy !== null && retailYoy !== null) {
    reasons.push(
      `전년 동기 대비 출하 ${shipYoy.toFixed(1)}% · 소매 ${retailYoy.toFixed(1)}% (차이 ${(shipYoy - retailYoy).toFixed(1)}%p)`
    );
  }
  reasons.push(
    `최근 ${TREND_WINDOW_QUARTERS}분기 누적 갭 ${recentGap >= 0 ? '+' : ''}${recentGap.toLocaleString('ko-KR')}대 → 재고 ${recentGap > 0 ? '축적' : '소진'}`
  );

  // Cox 실측 교차검증 — 스텔란티스 브랜드가 업계 평균 대비 몇 배인지.
  const coxNote = describeCox(cox);
  if (coxNote) reasons.push(coxNote);

  const shipOutpacingRetail = shipYoy !== null && retailYoy !== null && shipYoy > retailYoy;
  const building = recentGap > 0;

  if (shipOutpacingRetail && building) {
    return {
      level: 'red',
      headline: '재고 축적 · 향후 감산 위험',
      reasons: [
        ...reasons,
        '출하가 소매를 앞지르며 재고가 쌓이고 있습니다. 스텔란티스가 재고를 되돌리려면 출하를 줄여야 하고, 그러면 자사 매출도 함께 줄어듭니다.',
      ],
    };
  }
  if (!shipOutpacingRetail && !building) {
    return {
      level: 'green',
      headline: '재고 소진 · 보충 출하 기대',
      reasons: [
        ...reasons,
        '소매가 출하를 앞질러 재고가 줄고 있습니다. 재고를 다시 채우려면 출하를 늘려야 하므로 자사 매출에 우호적입니다.',
      ],
    };
  }
  return {
    level: 'yellow',
    headline: '혼조 — 방향 미확정',
    reasons: [...reasons, '출하·소매 증감과 재고 방향이 같은 쪽을 가리키지 않습니다.'],
  };
}

/** Cox 최신 월 기준 스텔란티스 브랜드의 업계 평균 대비 배율 문장. */
export function describeCox(cox: CoxInventoryRow[]): string | null {
  if (cox.length === 0) return null;
  const latestMonth = Math.max(...cox.map((r) => r.year_month));
  const rows = cox.filter((r) => r.year_month === latestMonth);
  const nation = rows.find((r) => r.brand === 'NATION')?.days_supply;
  if (!nation) return null;

  const parts = STELLANTIS_COX_BRANDS.map((brand) => {
    const row = rows.find((r) => r.brand === brand);
    if (!row) return null;
    if (row.days_supply === null) {
      // Cox가 업계 평균 2배 초과라 값을 감춘 경우 — 값이 없는 게 아니라 '심각하다'는 신호다.
      return `${brand} ${nation * COX_OUTLIER_MULTIPLE}일 초과(Cox 미공개)`;
    }
    return `${brand} ${row.days_supply}일`;
  }).filter((s): s is string => s !== null);
  if (parts.length === 0) return null;

  return `Cox ${monthLabel(latestMonth)} 딜러 재고일수 — ${parts.join(' · ')} (업계 평균 ${nation}일)`;
}

// ---------------------------------------------------------------------------
// 전망
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 전망 = 출하 전망 × 대당 매출.
 *
 * 출하 전망은 3개 시나리오로 나눈다. 하나의 숫자를 내놓는 대신 가정을 드러내는 쪽이
 * 표본 22분기짜리 데이터에 정직하다(사용자 결정 2026-07-15 — 회귀 예측 거부).
 */
export function buildForecast(
  gap: GapPoint[],
  unitRevenue: UnitRevenueSeries,
  revenueQuarters: Map<string, number>
): ForecastSeries {
  const actual = [...revenueQuarters.entries()]
    .sort((a, b) => quarterIndex(a[0]) - quarterIndex(b[0]))
    .map(([yearPeriod, revenueEok]) => ({
      yearPeriod,
      label: quarterLabel(yearPeriod),
      revenueEok,
    }));

  if (gap.length === 0 || unitRevenue.points.length === 0) {
    return { actual, scenarios: [], lowConfidence: true };
  }

  const wonPerUnit = mean(
    unitRevenue.points.slice(-TREND_WINDOW_QUARTERS).map((p) => p.wonPerUnit)
  );
  const recentRetail = mean(gap.slice(-TREND_WINDOW_QUARTERS).map((p) => p.retail));
  const recentShipments = mean(gap.slice(-TREND_WINDOW_QUARTERS).map((p) => p.shipments));
  const excess = recentGapSum(gap, TREND_WINDOW_QUARTERS);
  const lastIndex = quarterIndex(gap[gap.length - 1].yearPeriod);

  const project = (shipmentsFor: (i: number) => number): ForecastPoint[] =>
    Array.from({ length: FORECAST_QUARTERS }, (_, i) => {
      const yearPeriod = quarterFromIndex(lastIndex + i + 1);
      const shipments = Math.max(0, Math.round(shipmentsFor(i)));
      return {
        yearPeriod,
        label: quarterLabel(yearPeriod),
        shipments,
        revenueEok: (shipments * wonPerUnit) / EOK_TO_WON,
      };
    });

  const scenarios: ForecastScenario[] = [
    {
      key: 'inventoryHold',
      label: '재고 유지',
      assumption: `출하를 최근 ${TREND_WINDOW_QUARTERS}분기 평균 소매(${Math.round(recentRetail).toLocaleString('ko-KR')}대) 수준으로 맞춰 재고를 현 수준에서 동결한다고 가정.`,
      points: project(() => recentRetail),
    },
    {
      key: 'inventoryNormalize',
      label: '재고 정상화',
      assumption: `최근 ${TREND_WINDOW_QUARTERS}분기 누적 갭 ${excess >= 0 ? '+' : ''}${excess.toLocaleString('ko-KR')}대를 향후 ${NORMALIZE_OVER_QUARTERS}분기에 걸쳐 해소한다고 가정(과잉이면 출하 하향, 부족이면 상향).`,
      points: project(
        (i) => recentRetail - (i < NORMALIZE_OVER_QUARTERS ? excess / NORMALIZE_OVER_QUARTERS : 0)
      ),
    },
    {
      key: 'trendContinue',
      label: '현 추세 지속',
      assumption: `최근 ${TREND_WINDOW_QUARTERS}분기 평균 출하(${Math.round(recentShipments).toLocaleString('ko-KR')}대)가 그대로 이어진다고 가정 — 재고 조정이 일어나지 않는 경우.`,
      points: project(() => recentShipments),
    },
  ];

  return { actual, scenarios, lowConfidence: unitRevenue.cv > UNIT_REVENUE_CV_WARN };
}
