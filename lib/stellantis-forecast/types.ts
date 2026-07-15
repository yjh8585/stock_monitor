/**
 * 스텔란티스 북미 매출 전망(/management/stellantis) 도메인 타입.
 *
 * 지표 3축의 정의가 서로 다르니 혼동 금지 (docs/oem-collection.md 참고):
 *  - **출하(shipments)**: 공장→딜러 인도. OEM 매출 인식 기준. Stellantis IR, 북미 지역 단위.
 *  - **소매(retail)**: 딜러→최종고객 인도. MarkLines(월·국가별) / prnewswire(분기·미국).
 *  - **재고(days' supply)**: 딜러 보유 재고를 일평균 판매로 나눈 일수. Cox, 브랜드별 월간.
 *
 * 항등식: 출하 − 소매 = 딜러 재고 증감. 세 축이 같은 이야기를 하는지 보는 게 이 페이지의 목적.
 */

/** `stellantis_shipments` 한 행. shipments_units = 대(units). */
export interface ShipmentRow {
  region: string;
  year_period: string;
  shipments_units: number;
  /** H1/FY 차분으로 도출된 값인지 (천대 반올림 오차 ±1,000대 누적). */
  is_derived: boolean;
}

/** MarkLines 월·국가·모델별 소매 판매 한 행. */
export interface RetailMonthRow {
  country: string;
  model: string;
  year_month: number;
  sales: number;
}

/**
 * `cox_brand_inventory` 한 행.
 *
 * `days_supply === null`은 **값이 없다는 뜻이 아니다** — Cox가 업계 평균(NATION)의 2배를 넘는
 * 브랜드를 차트에서 빼고 이름만 싣기 때문에 생기는 결측이며, 사실상 "NATION × 2 이상"이라는
 * 강한 신호다(DB의 `is_outlier_excluded = true`). Chrysler가 202512~202603에 이 상태였다.
 * 반대로 **행 자체가 없으면** 저물량 상시 제외(Fiat·Alfa Romeo)·그 달 로스터 누락·판독 실패 중
 * 하나로 우리가 모르는 상태다. 둘을 섞으면 안 된다.
 */
export interface CoxInventoryRow {
  brand: string;
  year_month: number;
  days_supply: number | null;
}

/** 자사 Stellantis NA향 월별 매출 (사외비 pnl_entries에서 추출, 억원). */
export interface RevenueMonthRow {
  year_month: number;
  /** 억원. 원본이 null이면 행 자체를 만들지 않는다. */
  revenueEok: number;
}

/** 차트 1 — 출하 vs 소매 vs 재고 증감. 단위 = 대. */
export interface GapPoint {
  /** 'YYYY-QN' */
  yearPeriod: string;
  /** '25Q1' 형태 표시 라벨 */
  label: string;
  shipments: number;
  retail: number;
  /** 출하 − 소매. 양수 = 재고 축적, 음수 = 재고 소진. */
  gap: number;
  /** gap 누적 (시작점이 임의라 절대 수준이 아니라 방향만 읽는다). */
  cumGap: number;
  /** 출하가 차분 도출된 분기인지 — UI에서 구분 표시. */
  isDerived: boolean;
}

/** 시차 탐지 결과. */
export interface LagResult {
  /** 채택 시차(개월). 양수 = 자사 매출이 소매보다 **선행**. */
  lagMonths: number;
  /** 채택 시차의 상관계수 (YoY 증감률 기준). */
  r: number;
  /** 상관 계산에 쓰인 표본 수. */
  n: number;
  /** 전 시차 후보 (화면에 근거로 노출 — 블랙박스 금지). */
  candidates: LagCandidate[];
}

export interface LagCandidate {
  lagMonths: number;
  r: number;
  n: number;
}

/** 차트 3 — 대당 매출 원단위. */
export interface UnitRevenuePoint {
  yearPeriod: string;
  label: string;
  /** 자사 매출(억원) ÷ 북미 출하(대) × 10^8 = 대당 원(￦). */
  wonPerUnit: number;
}

export interface UnitRevenueSeries {
  points: UnitRevenuePoint[];
  /** 평균 대당 매출 (￦). */
  mean: number;
  /** 변동계수 = 표준편차 / 평균. 클수록 전망 신뢰도가 낮다. */
  cv: number;
}

/** 진단 신호 3색. */
export type DiagnosisLevel = 'red' | 'yellow' | 'green';

export interface Diagnosis {
  level: DiagnosisLevel;
  /** 한 줄 요약 (화면 카드 제목). */
  headline: string;
  /** 판정 근거 — 사람이 읽고 검증할 수 있게 문장으로. */
  reasons: string[];
}

/** 전망 시나리오 1개. */
export interface ForecastScenario {
  key: 'inventoryHold' | 'inventoryNormalize' | 'trendContinue';
  label: string;
  /** 이 시나리오가 무슨 가정인지 — 화면에 문장으로 노출. */
  assumption: string;
  points: ForecastPoint[];
}

export interface ForecastPoint {
  yearPeriod: string;
  label: string;
  /** 전망 북미 출하 (대). */
  shipments: number;
  /** 전망 자사 매출 (억원) = 출하 × 원단위. */
  revenueEok: number;
}

/** 차트 4 — 실적 + 전망. */
export interface ForecastSeries {
  /** 실적 구간 (억원). */
  actual: { yearPeriod: string; label: string; revenueEok: number }[];
  scenarios: ForecastScenario[];
  /** 원단위 CV가 커서 신뢰도 경고가 필요한지. */
  lowConfidence: boolean;
}

/** 페이지 전체 데이터. */
export interface StellantisForecastData {
  gap: GapPoint[];
  lag: LagResult | null;
  unitRevenue: UnitRevenueSeries;
  diagnosis: Diagnosis;
  forecast: ForecastSeries;
  cox: CoxInventoryRow[];
  /** 자사 매출 vs 소매 대비 (차트 2) — 시차 적용 후. */
  revenueVsRetail: RevenueVsRetailPoint[];
  /** 3개국 모두 채워진 마지막 분기. 이후는 잠정이라 계산에서 제외했다. */
  lastCompleteQuarter: string | null;
  /** 잠정(부분 수집) 분기 라벨 — 화면 각주용. null이면 없음. */
  partialQuarterNote: string | null;
}

/** 차트 2 — 자사 매출(막대) + 스텔란티스 북미 소매(선), 시차 정렬. */
export interface RevenueVsRetailPoint {
  yearMonth: number;
  label: string;
  /** 자사 매출 (억원). */
  revenueEok: number | null;
  /** 시차만큼 밀어 정렬한 스텔란티스 북미 소매 (대). */
  retailShifted: number | null;
}
