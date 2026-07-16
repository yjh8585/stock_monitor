/**
 * 스텔란티스 북미 매출 전망(/management/stellantis) 순수 집계 빌더.
 *
 * 이 모듈이 답하려는 질문은 둘이다:
 *  ① 스텔란티스 재고가 쌓이고 있는가?  → 두 항등식을 나란히 세운다(차트 1·2 + 재고 신호등 KPI)
 *  ② 각 지표가 전년 대비 어디로 가는가?  → YTD YoY KPI(`buildRetailKpi`·`buildShipmentsKpi`·
 *     `buildRevenueKpi`)
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
  CoxInventoryRow,
  GapPoint,
  InventoryKpi,
  KpiMetric,
  KpiMetricKey,
  MonthlyFlowPoint,
  PlantEvent,
  PlantEventWithContext,
  ProductionMonthRow,
  RetailMonthRow,
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

/** 공장 이벤트 직전 재고 국면을 볼 때 쓰는 관찰 창(개월) — `attachEventContext`. */
const STATE_WINDOW_MONTHS = 6;

/**
 * 차트 2(월별 생산 갭)의 시작월(YYYYMM).
 *
 * 생산·소매 원본은 2020.01부터 있으나, 차트 1(분기 출하)이 2021-Q1부터라 시작점을 맞춘다
 * (사용자 지시 2026-07-17). 두 차트가 같은 시작 연도에서 출발해야 눈으로 대조된다.
 */
export const CHART_START_MONTH = 202101;

/** Cox 재고일수를 '재고' 이벤트로 만들 때 대상 스텔란티스 브랜드. */
const STELLANTIS_BRANDS: readonly string[] = ['Jeep', 'Ram', 'Dodge', 'Chrysler'];

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
  retailByMonth: Map<number, number>,
  minMonth: number | null = null
): MonthlyFlowPoint[] {
  // minMonth 이전 월은 누적(cumGap) 이전에 걸러 낸다 — 잘라낸 기간이 cumGap에 스며들지 않게.
  const months = [...productionByMonth.keys()]
    .filter((m) => retailByMonth.has(m))
    .filter((m) => minMonth === null || m >= minMonth)
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
// KPI 카드 — YTD(당해 누적) YoY + 재고 신호등
// ---------------------------------------------------------------------------

/** 월별 계열의 당해 연도 1월~cutoffMonth(포함) 누적. 없는 달은 0으로 친다. */
function ytdMonthlySum(byMonth: Map<number, number>, year: number, cutoffMonthNum: number): number {
  let sum = 0;
  for (let m = 1; m <= cutoffMonthNum; m += 1) {
    sum += byMonth.get(year * 100 + m) ?? 0;
  }
  return sum;
}

/** 전년 같은 span(1~cutoff월)에 데이터가 하나라도 있는지. */
function priorYearHasMonths(
  byMonth: Map<number, number>,
  year: number,
  cutoffMonthNum: number
): boolean {
  for (const ym of byMonth.keys()) {
    if (Math.floor(ym / 100) === year - 1 && ym % 100 <= cutoffMonthNum) return true;
  }
  return false;
}

/** 월 누적 기간 라벨. 6월까지면 '상반기', 12월까지면 '연간'. */
function ytdMonthLabel(year: number, cutoffMonthNum: number): string {
  if (cutoffMonthNum === 6) return `${year} 상반기 (1~6월)`;
  if (cutoffMonthNum === 12) return `${year} 연간 (1~12월)`;
  return `${year}.1~${cutoffMonthNum}월 누적`;
}

/** 분기 누적 기간 라벨. Q2까지면 '상반기', Q4까지면 '연간'. */
function ytdQuarterLabel(year: number, cutoffQuarterNum: number): string {
  if (cutoffQuarterNum === 2) return `${year} 상반기 (Q1~Q2)`;
  if (cutoffQuarterNum === 4) return `${year} 연간 (Q1~Q4)`;
  return `${year} Q1~Q${cutoffQuarterNum}`;
}

function makeKpiMetric(params: {
  key: KpiMetricKey;
  label: string;
  unit: 'units' | 'eok';
  currentValue: number;
  priorValue: number;
  priorHasData: boolean;
  periodLabel: string;
}): KpiMetric {
  const { key, label, unit, currentValue, priorValue, priorHasData, periodLabel } = params;
  const absChange = currentValue - priorValue;
  const yoyPct = priorHasData && priorValue !== 0 ? (absChange / priorValue) * 100 : null;
  return {
    key,
    label,
    periodLabel,
    currentValue,
    priorValue,
    yoyPct,
    absChange,
    unit,
    available: true,
  };
}

function emptyKpiMetric(key: KpiMetricKey, label: string, unit: 'units' | 'eok'): KpiMetric {
  return {
    key,
    label,
    periodLabel: '—',
    currentValue: 0,
    priorValue: 0,
    yoyPct: null,
    absChange: 0,
    unit,
    available: false,
  };
}

/**
 * 소매 판매 KPI — MarkLines 북미 소매, 당해 1월~최신 완성월 누적 YoY.
 *
 * `retailByMonth`는 이미 완성월까지 잘려 있으므로(source에서 cutoff 적용) 최신 키가 곧 완성월이다.
 * 전년 동기간(1~같은 월)과 비교한다.
 */
export function buildRetailKpi(retailByMonth: Map<number, number>): KpiMetric {
  if (retailByMonth.size === 0) return emptyKpiMetric('retail', '소매 판매', 'units');
  const latest = Math.max(...retailByMonth.keys());
  const year = Math.floor(latest / 100);
  const cutoff = latest % 100;
  return makeKpiMetric({
    key: 'retail',
    label: '소매 판매',
    unit: 'units',
    currentValue: ytdMonthlySum(retailByMonth, year, cutoff),
    priorValue: ytdMonthlySum(retailByMonth, year - 1, cutoff),
    priorHasData: priorYearHasMonths(retailByMonth, year, cutoff),
    periodLabel: ytdMonthLabel(year, cutoff),
  });
}

/** 출하량 KPI — 분기 출하의 당해 Q1~최신 분기 누적 YoY. */
export function buildShipmentsKpi(shipments: ShipmentRow[]): KpiMetric {
  if (shipments.length === 0) return emptyKpiMetric('shipments', '출하량', 'units');
  const latestIdx = Math.max(...shipments.map((s) => quarterIndex(s.year_period)));
  const year = Math.floor(latestIdx / 4);
  const cutoffQ = (latestIdx % 4) + 1;
  const ytd = (y: number): number =>
    shipments
      .filter((s) => {
        const i = quarterIndex(s.year_period);
        return Math.floor(i / 4) === y && (i % 4) + 1 <= cutoffQ;
      })
      .reduce((acc, s) => acc + s.shipments_units, 0);
  const priorHasData = shipments.some((s) => {
    const i = quarterIndex(s.year_period);
    return Math.floor(i / 4) === year - 1 && (i % 4) + 1 <= cutoffQ;
  });
  return makeKpiMetric({
    key: 'shipments',
    label: '출하량',
    unit: 'units',
    currentValue: ytd(year),
    priorValue: ytd(year - 1),
    priorHasData,
    periodLabel: ytdQuarterLabel(year, cutoffQ),
  });
}

/** 스텔란티스향 매출 KPI (사외비) — 당해 1월~최신월 누적 YoY(억원). */
export function buildRevenueKpi(revenue: RevenueMonthRow[]): KpiMetric {
  if (revenue.length === 0) return emptyKpiMetric('revenue', '스텔란티스향 매출', 'eok');
  const byMonth = new Map(revenue.map((r) => [r.year_month, r.revenueEok]));
  const latest = Math.max(...byMonth.keys());
  const year = Math.floor(latest / 100);
  const cutoff = latest % 100;
  return makeKpiMetric({
    key: 'revenue',
    label: '스텔란티스향 매출',
    unit: 'eok',
    currentValue: ytdMonthlySum(byMonth, year, cutoff),
    priorValue: ytdMonthlySum(byMonth, year - 1, cutoff),
    priorHasData: priorYearHasMonths(byMonth, year, cutoff),
    periodLabel: ytdMonthLabel(year, cutoff),
  });
}

/**
 * 재고 증감 KPI — 신호등.
 *
 * 분기 갭(출하 − 소매) 계열의 **최신 부호**로 방향을 정하고, 같은 부호가 뒤에서 몇 분기 이어졌는지
 * 센다. 재고 증가(building)면 향후 감산 → 당사 매출 하방이라 **빨강**, 재고 감소(draining)면 **초록**,
 * 균형이면 **노랑**(사용자 지시 2026-07-16 — 신호등).
 */
export function buildInventoryKpi(gapSeries: GapPoint[]): InventoryKpi {
  if (gapSeries.length === 0) {
    return {
      label: '재고 증감',
      status: 'yellow',
      headline: '데이터 부족',
      detail: '출하·소매가 모두 있는 분기가 없습니다.',
      consecutiveQuarters: 0,
      direction: 'flat',
    };
  }
  const latest = gapSeries[gapSeries.length - 1];
  const dir: 'building' | 'draining' | 'flat' =
    latest.gap > 0 ? 'building' : latest.gap < 0 ? 'draining' : 'flat';

  let n = 0;
  if (dir !== 'flat') {
    for (let i = gapSeries.length - 1; i >= 0; i -= 1) {
      const g = gapSeries[i].gap;
      const s = g > 0 ? 'building' : g < 0 ? 'draining' : 'flat';
      if (s !== dir) break;
      n += 1;
    }
  }

  if (dir === 'building') {
    return {
      label: '재고 증감',
      status: 'red',
      headline: `${n}분기 연속 재고 증가`,
      detail:
        '출하가 소매를 웃돌아 딜러 재고가 쌓이고 있습니다. 스텔란티스가 재고를 되돌리려 출하(=당사 매출)를 줄일 수 있어 향후 매출에 하방 위험입니다.',
      consecutiveQuarters: n,
      direction: 'building',
    };
  }
  if (dir === 'draining') {
    return {
      label: '재고 증감',
      status: 'green',
      headline: `${n}분기 연속 재고 감소`,
      detail:
        '소매가 출하를 웃돌아 딜러 재고가 줄고 있습니다. 재고 보충을 위해 출하가 늘면 당사 매출에 우호적입니다.',
      consecutiveQuarters: n,
      direction: 'draining',
    };
  }
  return {
    label: '재고 증감',
    status: 'yellow',
    headline: '재고 방향 혼조',
    detail: '출하와 소매가 균형에 가까워 재고 방향이 뚜렷하지 않습니다.',
    consecutiveQuarters: 0,
    direction: 'flat',
  };
}

// ---------------------------------------------------------------------------
// 재고 이벤트 자동 생성 (Cox 딜러 재고일수)
// ---------------------------------------------------------------------------

/**
 * Cox 브랜드별 딜러 재고일수를 월별 '재고' 이벤트로 **자동 생성**한다.
 *
 * 공장 동향의 '재고' 항목을 사람이 손으로 옮겨 적던 것을(수동 큐레이션) 이미 자동 수집돼
 * DB에 쌓이는 `cox_brand_inventory`에서 만들어 낸다(사용자 지시 2026-07-17 — "재고만 자동").
 * Cox가 매월 갱신되면 재고 타임라인이 저절로 늘어난다.
 *
 * - 한 달에 스텔란티스 브랜드(Jeep·Ram·Dodge·Chrysler)가 하나도 없으면 이벤트를 만들지 않는다.
 * - `excludeMonths`에 든 월은 건너뛴다 — 그 달은 이미 **수동 큐레이션 항목**(더 풍부한 서술)이
 *   있어 자동 항목과 중복시키지 않기 위함이다(수동 우선).
 * - NATION(업계 평균)×2 초과로 Cox가 값을 뺀 브랜드(`is_outlier_excluded` 또는 `days_supply=null`)는
 *   수치 대신 "차트 제외"라는 사실만 문구에 남긴다.
 */
export function buildCoxInventoryEvents(
  rows: CoxInventoryRow[],
  excludeMonths: ReadonlySet<number> = new Set()
): PlantEvent[] {
  const byMonth = new Map<number, Map<string, CoxInventoryRow>>();
  for (const row of rows) {
    let brands = byMonth.get(row.year_month);
    if (!brands) {
      brands = new Map();
      byMonth.set(row.year_month, brands);
    }
    brands.set(row.brand, row);
  }

  const events: PlantEvent[] = [];
  for (const [yearMonth, brands] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
    if (excludeMonths.has(yearMonth)) continue;

    const present = STELLANTIS_BRANDS.filter((b) => brands.has(b));
    if (present.length === 0) continue;

    const shown: string[] = [];
    const excluded: string[] = [];
    for (const brand of STELLANTIS_BRANDS) {
      const row = brands.get(brand);
      if (!row) continue;
      if (row.is_outlier_excluded || row.days_supply === null) excluded.push(brand);
      else shown.push(`${brand} ${row.days_supply}일`);
    }

    const nation = brands.get('NATION')?.days_supply ?? null;
    const nationText = nation !== null ? ` (업계 평균 ${nation}일)` : '';
    let summary = `${monthLabel(yearMonth)} 미국 딜러 재고일수 — ${shown.join(' · ')}${nationText}. Cox Automotive 집계.`;
    if (excluded.length > 0) {
      summary += ` ${excluded.join('·')}은(는) 업계 평균 2배 초과로 Cox 차트에서 제외(수치 미공개).`;
    }

    events.push({
      plant: '미국 딜러 네트워크 (Cox 집계 딜러 재고일수 — 자동 수집)',
      country: 'USA',
      startYearMonth: yearMonth,
      endYearMonth: yearMonth,
      eventType: 'inventory',
      models: present.slice(),
      summary,
      statedReason: '',
      inventoryRelation: 'response_to_glut',
      sourceUrl: brands.get(present[0])?.source_url ?? 'https://www.coxautoinc.com/insights/',
      sourceName: 'Cox Automotive',
      sourceDate: null,
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// 공장 이벤트 컨텍스트
// ---------------------------------------------------------------------------

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
