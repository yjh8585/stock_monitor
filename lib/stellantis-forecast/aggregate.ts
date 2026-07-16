/**
 * 스텔란티스 북미 매출 전망(/management/stellantis) 순수 집계 빌더.
 *
 * 이 모듈이 답하려는 질문은 셋이다:
 *  ① 스텔란티스 재고가 쌓이고 있는가?  → 두 항등식을 나란히 세운다(차트 1·2)
 *  ② 자사 매출은 시간을 두고 무엇을 따라가는가?  → 3축 시차 상관(`analyzeDrivers`)
 *  ③ 재고가 이 방향이면 자사 매출은 어디로 가는가?  → 조건부 빈도(`buildInventoryOutlook`)
 *
 * **두 재고 경로의 성격 차이가 이 모듈의 핵심 전제다:**
 *  - `출하 − 소매 = 딜러 재고 증감` — 정확한 항등식. 단 분기 단위이고 최신 분기가 늘 비어 있다.
 *  - `생산 − 소매 ≈ 파이프라인 재고 증감` — 근사. 대신 월별로 즉시 갱신된다.
 *    ⚠️ 생산은 **공장 국가**, 소매는 **판매 시장** 기준이라 북미 밖 수출입이 갭에 섞인다.
 *    실측(2024.01~2026.05): 북미 생산이 북미 소매의 +3.1%. 순합은 작지만 두 큰 흐름의 차라
 *    절대 수준이 아니라 **방향·변화**만 읽어야 한다.
 *
 * 스코프 정합 (틀리면 전부 무의미해진다):
 *  - 출하는 Stellantis IR의 **North America 세그먼트**(미국+캐나다+멕시코, **마세라티 제외** —
 *    마세라티는 별도 세그먼트). 따라서 소매도 3개국 합산 + 마세라티 제외로 맞춘다.
 *  - 북미 공장은 마세라티를 만들지 않으므로 생산 쪽은 자동으로 스코프가 맞는다.
 *  - MarkLines는 **국가별로 도착 시점이 다르다** → 3개국이 다 채워진 기간까지만 쓴다.
 *    안 그러면 소매가 과소집계돼 재고 축적을 과대평가한다.
 */
import type {
  ConditionalRate,
  CoxInventoryRow,
  Diagnosis,
  DriverAxis,
  DriverLagProfile,
  GapPoint,
  InventoryOutlook,
  LagCandidate,
  LagResult,
  MonthlyFlowPoint,
  PlantEvent,
  PlantEventWithContext,
  ProductionMonthRow,
  RetailMonthRow,
  RevenueDriverAnalysis,
  RevenueMonthRow,
  ShipmentRow,
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

/** IR North America 세그먼트 구성 국가 (MarkLines country 라벨). 생산·소매 공통. */
export const NA_COUNTRIES: readonly string[] = ['USA', 'Canada', 'Mexico'];

/** 스텔란티스 브랜드 (Cox 차트에 실리는 것만 — Fiat·Alfa Romeo는 물량 미달로 미수록). */
export const STELLANTIS_COX_BRANDS: readonly string[] = ['Jeep', 'Ram', 'Dodge', 'Chrysler'];

/** Cox가 이상치로 제외하는 기준 — 업계 평균 대비 배수. */
export const COX_OUTLIER_MULTIPLE = 2;

/** 시차 탐색 범위(개월). 자사 매출 53개월이라 ±6이면 lag별 표본 35~41로 충분. */
export const MAX_LAG_MONTHS = 6;

/** 상관을 신뢰할 최소 표본 수. 이보다 적으면 시차를 채택하지 않는다. */
export const MIN_LAG_SAMPLES = 12;

/**
 * 조건부 확률을 화면에서 숫자로 강조해도 되는 최소 표본 수.
 *
 * 8개 미만이면 Wilson 구간이 사실상 [0,1]에 가까워 어떤 비율도 정보가 아니다.
 * (분기 축은 겹치는 표본이 13개 안팎이라 이 문턱을 겨우 넘는다 — 그래서 화면이 n을 항상 함께 쓴다.)
 */
export const MIN_CONDITIONAL_SAMPLES = 8;

/** 추세 계산에 쓰는 최근 분기 수. */
const TREND_WINDOW_QUARTERS = 4;

/**
 * 재고 국면 판정에 쓰는 관찰 창.
 *
 * 사용자 질문("6개월간 재고가 증가하고 있다면")을 그대로 옮긴 값이다. 월별 축은 6개월,
 * 분기 축은 같은 기간인 2분기.
 */
const STATE_WINDOW_MONTHS = 6;
const STATE_WINDOW_QUARTERS = 2;

/**
 * 결과를 보는 미래 시점.
 *
 * 창과 같은 길이로 둔다 — "최근 6개월 재고 방향이 앞으로 6개월 매출에 무엇을 시사하는가".
 * 시차 탐지 결과(`analyzeDrivers`)를 쓰지 않고 **고정값**을 쓰는 이유: 탐지 시차로 지평을
 * 정하면 같은 데이터로 지평을 고르고 그 지평에서 다시 확률을 재는 이중 데이터 스누핑이 된다.
 */
const OUTCOME_HORIZON_MONTHS = 6;
const OUTCOME_HORIZON_QUARTERS = 2;

/** Wilson 신뢰구간 z (95%). */
const Z_95 = 1.96;

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

/** '2025-Q1' → 분기 일련번호(정렬·시차 계산용). */
export function quarterIndex(yearPeriod: string): number {
  const [year, q] = yearPeriod.split('-');
  return Number(year) * 4 + Number(q.slice(1)) - 1;
}

/** 분기 일련번호 → '2025-Q1' */
export function quarterFromIndex(index: number): string {
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

/** 202503 → 월 일련번호. */
export function monthIndex(yearMonth: number): number {
  return Math.floor(yearMonth / 100) * 12 + ((yearMonth % 100) - 1);
}

/** 월 일련번호 → 202503 */
export function monthFromIndex(index: number): number {
  return Math.floor(index / 12) * 100 + (index % 12) + 1;
}

/** 202503에 n개월 더하기 → 202506 */
export function addMonths(yearMonth: number, n: number): number {
  return monthFromIndex(monthIndex(yearMonth) + n);
}

// ---------------------------------------------------------------------------
// MarkLines 수집 지연 처리 — 부분 기간을 섞지 않는 게 이 절의 전부
// ---------------------------------------------------------------------------

function isNaRetailRow(row: RetailMonthRow): boolean {
  return NA_COUNTRIES.includes(row.country) && !MASERATI_MODELS.has(row.model);
}

/** 국가별 최신 월의 min(). 한 나라라도 없으면 null(북미 합산 자체가 성립하지 않음). */
function commonLatestMonth(rows: { country: string; year_month: number }[]): number | null {
  const latestByCountry = new Map<string, number>();
  for (const row of rows) {
    if (!NA_COUNTRIES.includes(row.country)) continue;
    const prev = latestByCountry.get(row.country);
    if (prev === undefined || row.year_month > prev)
      latestByCountry.set(row.country, row.year_month);
  }
  if (latestByCountry.size < NA_COUNTRIES.length) return null;
  return Math.min(...latestByCountry.values());
}

/**
 * 3개국이 **모두** 소매 데이터를 가진 마지막 분기.
 *
 * MarkLines는 캐나다가 한 달 늦게 들어온다(2026-07-15 기준 USA·Mexico는 202606,
 * Canada는 202605). 이걸 무시하고 합산하면 최신 분기 소매가 과소집계돼
 * `출하 − 소매` 갭이 부풀고 **재고 축적을 과대평가**한다 — 이 페이지가 판정하려는 바로 그것이라 치명적.
 */
export function lastCompleteQuarter(rows: RetailMonthRow[]): string | null {
  const commonLatest = commonLatestMonth(rows);
  if (commonLatest === null) return null;
  const quarter = quarterOfYearMonth(commonLatest);
  // 분기 마지막 달까지 찼을 때만 완전 분기. 아니면 그 직전 분기.
  if ((commonLatest % 100) % 3 === 0) return quarter;
  return quarterFromIndex(quarterIndex(quarter) - 1);
}

/**
 * 생산·소매가 **3개국 모두** 채워진 마지막 월 (차트 1의 컷오프).
 *
 * 두 계열의 도착 시점이 서로 다르다(2026-07-15 실측: 생산은 USA·Canada가 202605·Mexico가 202606,
 * 소매는 USA·Mexico가 202606·Canada가 202605). 6개(3국 × 2계열) 중 가장 이른 월까지만 쓴다.
 *
 * 알려진 한계: DB에는 생산량이 0인 행을 넣지 않으므로(미도착과 진짜 0을 구분 못 함),
 * 어느 나라 생산이 실제로 한 달간 완전 정지하면 그 달을 '미도착'으로 오인해 차트가 한 달 짧아진다.
 * 데이터를 틀리게 그리는 게 아니라 덜 그리는 쪽이라 안전하며, 스텔란티스 북미는 2021년 이후
 * 전 월이 nonzero라 실제로 발생한 적이 없다.
 */
export function lastCompleteMonth(
  production: ProductionMonthRow[],
  retail: RetailMonthRow[]
): number | null {
  const prodLatest = commonLatestMonth(production);
  const retailLatest = commonLatestMonth(retail.filter(isNaRetailRow));
  if (prodLatest === null || retailLatest === null) return null;
  return Math.min(prodLatest, retailLatest);
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
    if (!isNaRetailRow(row)) continue;
    const quarter = quarterOfYearMonth(row.year_month);
    if (quarterIndex(quarter) > cutoff) continue;
    out.set(quarter, (out.get(quarter) ?? 0) + row.sales);
  }
  return out;
}

/** 월별 북미 소매 합계 (마세라티 제외). cutoff 이후는 부분 집계라 버린다. */
export function buildNaRetailMonths(
  rows: RetailMonthRow[],
  cutoffMonth: number | null = null
): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of rows) {
    if (!isNaRetailRow(row)) continue;
    if (cutoffMonth !== null && row.year_month > cutoffMonth) continue;
    out.set(row.year_month, (out.get(row.year_month) ?? 0) + row.sales);
  }
  return out;
}

/** 월별 북미 생산 합계. cutoff 이후는 부분 집계라 버린다. */
export function buildNaProductionMonths(
  rows: ProductionMonthRow[],
  cutoffMonth: number | null = null
): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of rows) {
    if (!NA_COUNTRIES.includes(row.country)) continue;
    if (cutoffMonth !== null && row.year_month > cutoffMonth) continue;
    out.set(row.year_month, (out.get(row.year_month) ?? 0) + row.production);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 차트 1 — 월별 생산 vs 소매
// ---------------------------------------------------------------------------

/**
 * 생산·소매가 **둘 다 있는** 월만 갭을 만든다.
 *
 * 한쪽만 있는 월을 0으로 채우면 가짜 갭이 생긴다(2026-06이 정확히 그 상황 — 생산은 멕시코만,
 * 소매는 캐나다만 빠져 그대로 빼면 −64,806대라는 허구가 나온다).
 */
export function buildMonthlyFlow(
  productionByMonth: Map<number, number>,
  retailByMonth: Map<number, number>
): MonthlyFlowPoint[] {
  const months = [...productionByMonth.keys()]
    .filter((m) => retailByMonth.has(m))
    .sort((a, b) => a - b);
  let cum = 0;
  return months.map((yearMonth) => {
    const production = productionByMonth.get(yearMonth) ?? 0;
    const retail = retailByMonth.get(yearMonth) ?? 0;
    const gap = production - retail;
    cum += gap;
    return { yearMonth, label: monthLabel(yearMonth), production, retail, gap, cumGap: cum };
  });
}

// ---------------------------------------------------------------------------
// 차트 2 — 분기 출하 vs 소매
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

/** '2026-Q2' → [202604, 202605, 202606] (분기 내 3개월은 연 경계를 넘지 않는다). */
export function monthsOfQuarter(yearPeriod: string): number[] {
  const [year, q] = yearPeriod.split('-');
  const startMonth = (Number(q.slice(1)) - 1) * 3 + 1;
  return [0, 1, 2].map((i) => Number(year) * 100 + startMonth + i);
}

/** NA 스코프(마세라티 제외) 소매를 (국가 → 월 → 대)로 집계. */
function naRetailByCountryMonth(rows: RetailMonthRow[]): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const row of rows) {
    if (!isNaRetailRow(row)) continue;
    let byMonth = out.get(row.country);
    if (!byMonth) {
      byMonth = new Map();
      out.set(row.country, byMonth);
    }
    byMonth.set(row.year_month, (byMonth.get(row.year_month) ?? 0) + row.sales);
  }
  return out;
}

/**
 * 한 국가의 빠진 월을 **최근 관측 YoY를 전년 동월에 적용**해 추정한다.
 *
 *   est(C, m) = retail(C, m−12) × [ retail(C, ref) / retail(C, ref−12) ]
 *
 * ref는 그 국가의 최신 실측월(예: 캐나다 202605). 근거 값(전년 동월·기준월·기준월 전년) 중
 * 하나라도 없거나 분모가 0이면 **추정하지 않고 null**을 돌려준다 — 근거 없는 수를 만들지 않는다.
 */
export function estimateCountryMonth(
  byMonth: Map<number, number>,
  targetMonth: number,
  refMonth: number
): number | null {
  const baseLastYear = byMonth.get(addMonths(targetMonth, -12));
  const refValue = byMonth.get(refMonth);
  const refLastYear = byMonth.get(addMonths(refMonth, -12));
  if (
    baseLastYear === undefined ||
    refValue === undefined ||
    refLastYear === undefined ||
    refLastYear === 0
  ) {
    return null;
  }
  return Math.round(baseLastYear * (refValue / refLastYear));
}

/**
 * 진행 중인 최신 분기를 **소매 일부 추정**으로 채운 갭 1개를 만든다 (차트 2 표시 전용).
 *
 * 배경(사용자 결정 2026-07-16): 출하는 Stellantis IR 분기 릴리스로 절대값이 일찍 나오지만
 * (예: 26Q2 445천대) MarkLines 소매는 국가별 도착이 늦어 그 분기가 아직 완전하지 않을 수 있다
 * (예: 미국·멕시코는 6월까지 왔는데 캐나다만 5월까지). 그럴 때 **빠진 국가·월을 추정치로 채우고
 * 화면에 '추정 포함'을 밝혀** 최신 분기까지 보여준다.
 *
 * 이 값은 **`gap`과 분리**된다. 통계(outlook·drivers)와 진단은 실측 완전 분기만 세야 하므로
 * 추정 분기를 절대 넣지 않는다. 오직 차트 2의 마지막 막대 하나를 위한 것이다.
 *
 * null을 돌려주는 경우(허구 방지): 진행 분기가 없음 / 이미 완전 분기임 / 그 분기 출하가 없음 /
 * 추정할 결측이 없음(정상 경로가 처리) / 추정 근거가 부족함.
 */
export function buildProjectedGapQuarter(
  gap: GapPoint[],
  shipments: ShipmentRow[],
  retailRows: RetailMonthRow[],
  completeQuarter: string | null
): { point: GapPoint; note: string } | null {
  const naMonths = retailRows.filter(isNaRetailRow).map((r) => r.year_month);
  if (naMonths.length === 0) return null;
  const progressQuarter = quarterOfYearMonth(Math.max(...naMonths));
  // 이미 완전한 분기면 투영할 게 없다(정상 경로가 그린다).
  if (completeQuarter && quarterIndex(progressQuarter) <= quarterIndex(completeQuarter)) {
    return null;
  }

  const shipment = shipments.find((s) => s.year_period === progressQuarter);
  if (!shipment) return null; // 출하 없으면 갭 자체가 성립하지 않는다

  const byCM = naRetailByCountryMonth(retailRows);
  const months = monthsOfQuarter(progressQuarter);
  let retailSum = 0;
  const estimated: { country: string; yearMonth: number }[] = [];
  for (const country of NA_COUNTRIES) {
    const byMonth = byCM.get(country);
    if (!byMonth) return null; // 국가 전체 결측이면 추정 근거가 없다
    const ref = Math.max(...byMonth.keys());
    for (const m of months) {
      const actual = byMonth.get(m);
      if (actual !== undefined) {
        retailSum += actual;
        continue;
      }
      const est = estimateCountryMonth(byMonth, m, ref);
      if (est === null) return null; // 근거 없으면 투영 자체를 포기
      retailSum += est;
      estimated.push({ country, yearMonth: m });
    }
  }
  if (estimated.length === 0) return null; // 추정할 게 없으면 정상 경로가 처리

  const gapValue = shipment.shipments_units - retailSum;
  const point: GapPoint = {
    yearPeriod: progressQuarter,
    label: quarterLabel(progressQuarter),
    shipments: shipment.shipments_units,
    retail: retailSum,
    gap: gapValue,
    cumGap: (gap.at(-1)?.cumGap ?? 0) + gapValue,
    isDerived: shipment.is_derived,
    isEstimated: true,
  };
  const estLabel = estimated.map((e) => `${e.country} ${monthLabel(e.yearMonth)}`).join(', ');
  const note =
    `${quarterLabel(progressQuarter)} 소매는 ${estLabel} 추정치를 포함합니다` +
    `(전년 동월 × 최근 YoY). 나머지 국가·월은 MarkLines 실측이며, 출하는 IR 공식 절대값입니다.`;
  return { point, note };
}

// ---------------------------------------------------------------------------
// 통계 기초
// ---------------------------------------------------------------------------

/**
 * 일련번호 키 계열 → 전년 동기 대비 증감률(%).
 *
 * 원계열(수준) 상관을 쓰면 둘 다 우상향·계절성만 있어도 r이 0.9씩 나온다(허위 상관).
 * 전년 동기 대비 증감률은 추세·계절성을 함께 제거해 "같이 흔들리는가"만 남긴다.
 */
export function toYoyByIndex(
  series: Map<number, number>,
  periodsPerYear: number
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [index, value] of series) {
    const prev = series.get(index - periodsPerYear);
    if (prev === undefined || prev === 0) continue;
    out.set(index, ((value - prev) / prev) * 100);
  }
  return out;
}

/** 월 키(YYYYMM) 계열 → YoY 증감률(%). */
export function toYoySeries(series: Map<number, number>): Map<number, number> {
  const byIndex = new Map([...series].map(([ym, v]) => [monthIndex(ym), v]));
  const yoy = toYoyByIndex(byIndex, 12);
  return new Map([...yoy].map(([i, v]) => [monthFromIndex(i), v]));
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
 * Wilson score 95% 신뢰구간.
 *
 * 정규근사(p̂ ± 1.96·√(p̂(1−p̂)/n))를 쓰지 않는 이유: 표본이 10~20개고 p̂이 0·1에 가까우면
 * 구간이 [0,1] 밖으로 나가거나 폭이 0이 되는 등 무의미해진다. Wilson은 작은 표본에서도
 * 구간이 항상 (0,1) 안에 있고 실제 포함확률이 명목값에 가깝다.
 *
 * ⚠️ 이 구간은 **관측이 서로 독립**이라고 가정한다. 이 페이지의 조건은 이동창(겹치는 구간)이라
 * 실제 독립 표본 수는 더 적고 **진짜 구간은 여기 나온 것보다 넓다**. 화면이 그 사실을 밝힌다.
 */
export function wilsonInterval(successes: number, total: number): { low: number; high: number } {
  if (total === 0) return { low: 0, high: 1 };
  const p = successes / total;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (Z_95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function makeRate(declines: number, total: number): ConditionalRate {
  const { low, high } = wilsonInterval(declines, total);
  return { declines, total, rate: total === 0 ? 0 : declines / total, ciLow: low, ciHigh: high };
}

// ---------------------------------------------------------------------------
// 시차 탐지 — "자사 매출은 무엇을 따라가는가"
// ---------------------------------------------------------------------------

/**
 * 일련번호 계열 두 개의 시차별 상관.
 *
 * 매칭 규칙: `자사 매출[t] ↔ 상대[t + lag]`.
 * lag > 0 = 자사 매출이 **선행**(부품을 먼저 납품하고 나중에 차가 나온다/팔린다).
 * lag < 0 = 자사 매출이 **후행**.
 */
function detectLagOnIndex(
  baseByIndex: Map<number, number>,
  otherByIndex: Map<number, number>,
  periodsPerYear: number,
  maxLagPeriods: number,
  minSamples: number
): { lagPeriods: number; r: number; n: number; candidates: LagCandidate[] } | null {
  const baseYoy = toYoyByIndex(baseByIndex, periodsPerYear);
  const otherYoy = toYoyByIndex(otherByIndex, periodsPerYear);
  const monthsPerPeriod = 12 / periodsPerYear;

  const candidates: LagCandidate[] = [];
  const raw: { lagPeriods: number; r: number; n: number }[] = [];
  for (let lag = -maxLagPeriods; lag <= maxLagPeriods; lag += 1) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [index, baseValue] of baseYoy) {
      const otherValue = otherYoy.get(index + lag);
      if (otherValue === undefined) continue;
      xs.push(baseValue);
      ys.push(otherValue);
    }
    const r = pearson(xs, ys);
    if (r === null || xs.length < minSamples) continue;
    candidates.push({ lagMonths: lag * monthsPerPeriod, r, n: xs.length });
    raw.push({ lagPeriods: lag, r, n: xs.length });
  }
  if (raw.length === 0) return null;
  const best = raw.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
  return { lagPeriods: best.lagPeriods, r: best.r, n: best.n, candidates };
}

/**
 * 자사 매출이 상대 월별 계열보다 몇 달 선행하는지 탐지.
 *
 * 추정하지 않고 데이터가 답하게 한다(사용자 결정 2026-07-15). 후보 전체를 함께 반환해
 * 화면에서 근거를 볼 수 있게 한다 — 블랙박스 금지.
 */
export function detectLag(
  revenueMonthly: Map<number, number>,
  otherMonthly: Map<number, number>,
  maxLag: number = MAX_LAG_MONTHS
): LagResult | null {
  const rev = new Map([...revenueMonthly].map(([ym, v]) => [monthIndex(ym), v]));
  const other = new Map([...otherMonthly].map(([ym, v]) => [monthIndex(ym), v]));
  const found = detectLagOnIndex(rev, other, 12, maxLag, MIN_LAG_SAMPLES);
  if (!found) return null;
  return { lagMonths: found.lagPeriods, r: found.r, n: found.n, candidates: found.candidates };
}

/** 자사 매출(분기 합) vs 분기 계열(출하)의 시차 탐지. 시차는 분기 단위라 월로 환산해 담는다. */
export function detectLagQuarterly(
  revenueQuarters: Map<string, number>,
  otherQuarters: Map<string, number>,
  maxLagQuarters: number,
  minSamples: number
): LagResult | null {
  const rev = new Map([...revenueQuarters].map(([q, v]) => [quarterIndex(q), v]));
  const other = new Map([...otherQuarters].map(([q, v]) => [quarterIndex(q), v]));
  const found = detectLagOnIndex(rev, other, 4, maxLagQuarters, minSamples);
  if (!found) return null;
  return { lagMonths: found.lagPeriods * 3, r: found.r, n: found.n, candidates: found.candidates };
}

/** 자사 월별 매출 → 분기 합계 (억원). */
export function revenueByQuarter(revenue: RevenueMonthRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of revenue) {
    const quarter = quarterOfYearMonth(row.year_month);
    out.set(quarter, (out.get(quarter) ?? 0) + row.revenueEok);
  }
  return out;
}

/** 분기 축(출하) 시차 탐색 범위 — ±2분기(±6개월)로 월별 축과 같은 폭을 본다. */
const MAX_LAG_QUARTERS = 2;

/** 분기 축은 표본이 원래 적다(출하 21분기). 월별과 같은 12를 요구하면 아무것도 안 나온다. */
const MIN_LAG_SAMPLES_QUARTERLY = 6;

/**
 * "자사 매출은 시간을 두고 무엇을 따라가는가" — 3축 시차 상관.
 *
 * 생산·소매(월별)와 출하(분기)에 각각 시차 상관을 걸고 |r|이 가장 큰 축을 leader로 뽑는다.
 * **결론을 단정하지 않고 근거와 한계를 함께 반환**한다 — 표본이 작고 다중비교가 있어
 * 최대 |r| 하나만 떼어 보면 반드시 과대해석하게 된다.
 */
export function analyzeDrivers(
  revenue: RevenueMonthRow[],
  productionByMonth: Map<number, number>,
  retailByMonth: Map<number, number>,
  shipments: ShipmentRow[]
): RevenueDriverAnalysis {
  const revenueMonthly = new Map(revenue.map((r) => [r.year_month, r.revenueEok]));
  const revenueQuarters = revenueByQuarter(revenue);
  const shipmentQuarters = new Map(shipments.map((s) => [s.year_period, s.shipments_units]));

  const specs: {
    axis: DriverAxis;
    axisLabel: string;
    granularity: 'month' | 'quarter';
    lag: LagResult | null;
  }[] = [
    {
      axis: 'production',
      axisLabel: '스텔란티스 북미 생산',
      granularity: 'month',
      lag: detectLag(revenueMonthly, productionByMonth),
    },
    {
      axis: 'retail',
      axisLabel: '스텔란티스 북미 소매 판매',
      granularity: 'month',
      lag: detectLag(revenueMonthly, retailByMonth),
    },
    {
      axis: 'shipments',
      axisLabel: '스텔란티스 북미 출하(도매)',
      granularity: 'quarter',
      lag: detectLagQuarterly(
        revenueQuarters,
        shipmentQuarters,
        MAX_LAG_QUARTERS,
        MIN_LAG_SAMPLES_QUARTERLY
      ),
    },
  ];

  const profiles: DriverLagProfile[] = specs.map((s) => ({
    ...s,
    unavailableReason:
      s.lag === null
        ? s.granularity === 'quarter'
          ? `겹치는 분기가 ${MIN_LAG_SAMPLES_QUARTERLY}개에 못 미쳐 계산하지 않았습니다.`
          : `겹치는 표본이 ${MIN_LAG_SAMPLES}개월에 못 미쳐 계산하지 않았습니다.`
        : null,
  }));

  const available = profiles.filter((p) => p.lag !== null);
  const leader =
    available.length === 0
      ? null
      : available.reduce((a, b) => (Math.abs(b.lag!.r) > Math.abs(a.lag!.r) ? b : a));

  const caveats = [
    '전년 동기 대비 증감률로 상관을 냅니다 — 원계열은 셋 다 우상향·계절성이 있어 그대로 상관을 내면 아무 관계나 r≈0.9가 나옵니다.',
    `축 3개 × 시차 후보 여러 개를 모두 시험한 뒤 |r|이 가장 큰 것을 고릅니다. 이렇게 고른 최대값은 우연만으로도 커지므로(다중비교), r 하나가 아니라 **시차별 프로파일의 모양**을 보십시오 — 이웃 시차까지 완만하게 높으면 실제 관계일 가능성이 크고, 한 점만 뾰족하면 우연일 가능성이 큽니다.`,
    'YoY 계열은 이웃한 달끼리 서로 닮아(자기상관) 실질 독립 표본 수가 표시된 n보다 적습니다. r은 참고 지표이지 통계적 검정 결과가 아닙니다.',
    '상관은 인과가 아닙니다. 자사 매출과 스텔란티스 지표가 같은 외부 요인(북미 자동차 수요 전반)에 함께 반응하는 것일 수 있습니다.',
  ];

  return { profiles, leader, caveats };
}

// ---------------------------------------------------------------------------
// 재고 방향 → 자사 매출 방향 (조건부 빈도)
// ---------------------------------------------------------------------------

/**
 * "재고가 N기간 쌓였다면 자사 매출이 줄어들 확률은?" — 과거 빈도로 답한다.
 *
 * 방법:
 *  1. 시점 t의 **국면** = 직전 `window` 기간 누적 갭의 부호 (양수면 축적, 음수면 소진).
 *  2. 시점 t의 **결과** = `horizon` 기간 뒤 자사 매출의 전년 동기 대비 증감률이 음수인가.
 *  3. 국면별로 결과가 '감소'였던 빈도를 센다. 전체 감소율(base)과 비교해야 의미가 산다 —
 *     매출이 원래 절반의 달에 감소했다면 "축적 국면에 50% 감소"는 아무 정보도 아니다.
 *
 * 회귀·모형을 쓰지 않는 이유: 표본이 수십 개뿐이라 계수를 추정하면 그럴듯한 숫자가 나오지만
 * 근거가 없다(사용자 결정 2026-07-15, 전망 시나리오에서 같은 판단). 세는 것은 정직하다.
 */
export function buildInventoryOutlook(params: {
  key: 'monthly' | 'quarterly';
  label: string;
  /** 기간 일련번호 → 갭(대). */
  gapByIndex: Map<number, number>;
  /** 기간 일련번호 → 자사 매출(억원). */
  revenueByIndex: Map<number, number>;
  periodsPerYear: number;
  windowPeriods: number;
  horizonPeriods: number;
  conditionLabel: string;
  outcomeLabel: string;
}): InventoryOutlook {
  const {
    key,
    label,
    gapByIndex,
    revenueByIndex,
    periodsPerYear,
    windowPeriods,
    horizonPeriods,
    conditionLabel,
    outcomeLabel,
  } = params;

  const revYoy = toYoyByIndex(revenueByIndex, periodsPerYear);
  const gapIndices = [...gapByIndex.keys()].sort((a, b) => a - b);

  /** t 시점의 직전 window 누적 갭. 창이 하나라도 비면 null(구멍을 0으로 메우지 않는다). */
  const windowSum = (t: number): number | null => {
    let sum = 0;
    for (let i = t - windowPeriods + 1; i <= t; i += 1) {
      const v = gapByIndex.get(i);
      if (v === undefined) return null;
      sum += v;
    }
    return sum;
  };

  let buildDeclines = 0;
  let buildTotal = 0;
  let drainDeclines = 0;
  let drainTotal = 0;
  let baseDeclines = 0;
  let baseTotal = 0;

  for (const t of gapIndices) {
    const sum = windowSum(t);
    if (sum === null) continue;
    const outcome = revYoy.get(t + horizonPeriods);
    if (outcome === undefined) continue;
    const declined = outcome < 0;
    baseTotal += 1;
    if (declined) baseDeclines += 1;
    if (sum > 0) {
      buildTotal += 1;
      if (declined) buildDeclines += 1;
    } else {
      drainTotal += 1;
      if (declined) drainDeclines += 1;
    }
  }

  // 현재 국면 — 갭이 있는 마지막 시점 기준.
  const latest = gapIndices.at(-1);
  const latestSum = latest === undefined ? null : windowSum(latest);
  const currentState: 'building' | 'draining' = (latestSum ?? 0) > 0 ? 'building' : 'draining';

  // 같은 국면이 이어진 기간 — 창 누적 부호가 언제부터 지금과 같았는지 거슬러 센다.
  let currentStreak = 0;
  if (latest !== undefined) {
    for (let t = latest; ; t -= 1) {
      const sum = windowSum(t);
      if (sum === null) break;
      const state = sum > 0 ? 'building' : 'draining';
      if (state !== currentState) break;
      currentStreak += 1;
    }
  }

  return {
    key,
    label,
    building: makeRate(buildDeclines, buildTotal),
    draining: makeRate(drainDeclines, drainTotal),
    base: makeRate(baseDeclines, baseTotal),
    conditionLabel,
    outcomeLabel,
    currentState,
    currentStreak,
    hasEnoughSamples:
      buildTotal >= MIN_CONDITIONAL_SAMPLES && drainTotal >= MIN_CONDITIONAL_SAMPLES,
  };
}

/** 월별(생산−소매)·분기별(출하−소매) 두 축의 재고→매출 전망을 만든다. */
export function buildInventoryOutlooks(
  monthlyFlow: MonthlyFlowPoint[],
  gap: GapPoint[],
  revenue: RevenueMonthRow[]
): InventoryOutlook[] {
  const revenueMonthIndex = new Map(revenue.map((r) => [monthIndex(r.year_month), r.revenueEok]));
  const revenueQuarterIndex = new Map(
    [...revenueByQuarter(revenue)].map(([q, v]) => [quarterIndex(q), v])
  );

  return [
    buildInventoryOutlook({
      key: 'monthly',
      label: '월별 · 생산 − 소매 기준',
      gapByIndex: new Map(monthlyFlow.map((p) => [monthIndex(p.yearMonth), p.gap])),
      revenueByIndex: revenueMonthIndex,
      periodsPerYear: 12,
      windowPeriods: STATE_WINDOW_MONTHS,
      horizonPeriods: OUTCOME_HORIZON_MONTHS,
      conditionLabel: `직전 ${STATE_WINDOW_MONTHS}개월 누적 (생산 − 소매) > 0`,
      outcomeLabel: `${OUTCOME_HORIZON_MONTHS}개월 뒤 자사 매출이 전년 동월보다 감소`,
    }),
    buildInventoryOutlook({
      key: 'quarterly',
      label: '분기별 · 출하 − 소매 기준',
      gapByIndex: new Map(gap.map((p) => [quarterIndex(p.yearPeriod), p.gap])),
      revenueByIndex: revenueQuarterIndex,
      periodsPerYear: 4,
      windowPeriods: STATE_WINDOW_QUARTERS,
      horizonPeriods: OUTCOME_HORIZON_QUARTERS,
      conditionLabel: `직전 ${STATE_WINDOW_QUARTERS}분기 누적 (출하 − 소매) > 0`,
      outcomeLabel: `${OUTCOME_HORIZON_QUARTERS}분기 뒤 자사 매출이 전년 동기보다 감소`,
    }),
  ];
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
 * **판정의 주축은 분기 출하 갭**(정확한 항등식)이고, 월별 생산 갭과 Cox 재고일수는
 * **독립 교차검증**으로 쓴다. 세 경로가 같은 방향이면 신뢰도가 올라가고, 어긋나면
 * 그 사실을 근거에 적어 사람이 판단하게 한다 — 조용히 하나만 믿지 않는다.
 */
export function diagnose(
  gap: GapPoint[],
  monthlyFlow: MonthlyFlowPoint[],
  cox: CoxInventoryRow[]
): Diagnosis {
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

  // 교차검증 ① — 월별 생산 갭(더 최신). 분기 출하 갭보다 3개월 이상 앞선 사실을 준다.
  const monthlyNote = describeMonthlyFlow(monthlyFlow);
  if (monthlyNote) reasons.push(monthlyNote);

  // 교차검증 ② — Cox 실측 재고일수.
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

/**
 * 공장 이벤트에 "그때 재고가 어땠는가"를 붙인다.
 *
 * 사용자 질문이 "공장 셧다운·오버홀·시프트 증감을 재고량과 연관지어 분석"이므로, 이벤트 문구가
 * 주장하는 사유(`statedReason`)가 아니라 **당시 실제 갭의 부호**를 붙여 대조할 수 있게 한다.
 * 회사가 "설비 전환"이라 발표해도 직전 6개월 갭이 크게 양수였다면 재고 과잉 대응일 수 있고,
 * 그 판단은 화면이 아니라 보는 사람이 한다 — 여기선 사실만 나란히 놓는다.
 *
 * 이벤트 시작월 **직전** 6개월을 쓰는 이유: 이벤트가 원인이 아니라 **결과**인지 보려는 것이므로,
 * 이벤트 자체가 만든 감산을 창에 넣으면 순환 논리가 된다.
 */
export function attachEventContext(
  events: PlantEvent[],
  monthlyFlow: MonthlyFlowPoint[]
): PlantEventWithContext[] {
  const gapByMonth = new Map(monthlyFlow.map((p) => [p.yearMonth, p.gap]));

  return [...events]
    .sort((a, b) => b.startYearMonth - a.startYearMonth)
    .map((event) => {
      // 직전 6개월 중 하나라도 데이터가 없으면 합을 만들지 않는다 — 부분합은 부호를 뒤집을 수 있다.
      const months: number[] = [];
      for (let i = 1; i <= STATE_WINDOW_MONTHS; i += 1) {
        months.push(addMonths(event.startYearMonth, -i));
      }
      const values = months.map((m) => gapByMonth.get(m));
      if (values.some((v) => v === undefined)) {
        return { event, precedingCumGap: null, precedingState: 'unknown' as const };
      }
      const sum = (values as number[]).reduce((acc, v) => acc + v, 0);
      return {
        event,
        precedingCumGap: sum,
        precedingState: (sum > 0 ? 'building' : 'draining') as 'building' | 'draining',
      };
    });
}

/** 최근 6개월 생산−소매 누적 문장 — 분기 출하 갭보다 최신인 교차검증 축. */
export function describeMonthlyFlow(monthlyFlow: MonthlyFlowPoint[]): string | null {
  if (monthlyFlow.length === 0) return null;
  const recent = monthlyFlow.slice(-STATE_WINDOW_MONTHS);
  const sum = recent.reduce((acc, p) => acc + p.gap, 0);
  const first = recent[0].label;
  const last = recent[recent.length - 1].label;
  return `월별 교차검증 — ${first}~${last} 누적 (생산 − 소매) ${sum >= 0 ? '+' : ''}${sum.toLocaleString('ko-KR')}대 → 파이프라인 재고 ${sum > 0 ? '축적' : '소진'} 방향`;
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
