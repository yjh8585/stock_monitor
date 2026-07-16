/**
 * 스텔란티스 북미 매출 전망(/management/stellantis) 도메인 타입.
 *
 * 지표 4축의 정의가 서로 다르니 혼동 금지 (docs/oem-collection.md 참고):
 *  - **생산(production)**: 공장 산출. MarkLines, 월·**생산국**별. `country`가 판매 시장이 아니다.
 *  - **출하(shipments)**: 공장→딜러 인도. OEM 매출 인식 기준. Stellantis IR, 분기·북미 지역 단위.
 *  - **소매(retail)**: 딜러→최종고객 인도. MarkLines, 월·**판매 시장**별.
 *  - **재고(days' supply)**: 딜러 보유 재고를 일평균 판매로 나눈 일수. Cox, 브랜드별 월간.
 *
 * 두 항등식을 나란히 본다:
 *  - **출하 − 소매 = 딜러 재고 증감** (정확. 단 분기·최신 분기 공백)  → 차트 2
 *  - **생산 − 소매 ≈ 파이프라인 재고 증감** (근사. 월별·즉시)        → 차트 1
 * 둘이 같은 방향을 가리키면 신뢰도가 올라가고, 어긋나면 그 사실 자체가 경고다.
 */

/** `stellantis_shipments` 한 행. shipments_units = 대(units). */
export interface ShipmentRow {
  region: string;
  year_period: string;
  shipments_units: number;
  /** H1/FY 차분으로 도출된 값인지 (천대 반올림 오차 ±1,000대 누적). */
  is_derived: boolean;
}

/** MarkLines 월·**판매 시장**·모델별 소매 판매 한 행. */
export interface RetailMonthRow {
  country: string;
  model: string;
  year_month: number;
  sales: number;
}

/**
 * MarkLines 월·**생산국**·모델별 생산 한 행.
 *
 * ⚠️ `country`는 공장이 있는 나라다. 같은 'USA'라도 `RetailMonthRow.country`(팔린 나라)와
 * 의미가 정반대이므로 두 계열을 차감할 때 반드시 의식할 것.
 */
export interface ProductionMonthRow {
  country: string;
  model: string;
  year_month: number;
  production: number;
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

/** 차트 2 — 분기 출하 vs 소매 vs 재고 증감. 단위 = 대. */
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
  /**
   * 소매가 **일부 추정치**로 채워진 분기인지 (차트 2 표시 전용).
   *
   * 출하는 IR 릴리스로 분기 절대값이 일찍 나오지만 MarkLines 소매는 국가별 도착이 늦어 최신
   * 분기가 아직 완전하지 않을 수 있다(예: 캐나다만 6월 미도착). 그 경우 빠진 국가·월을 추정해
   * 분기를 채우고 이 플래그를 세운다. **통계·진단은 이 분기를 쓰지 않는다** — 실측 완전 분기만.
   */
  isEstimated?: boolean;
}

/** 차트 1 — 월별 생산 vs 소매 vs 갭. 단위 = 대. MarkLines 단일 소스. */
export interface MonthlyFlowPoint {
  yearMonth: number;
  /** '25.03' 형태 표시 라벨 */
  label: string;
  /** 북미 공장(미국·캐나다·멕시코) 생산. */
  production: number;
  /** 북미 시장(미국·캐나다·멕시코) 소매 판매. 마세라티 제외. */
  retail: number;
  /** 생산 − 소매. 양수 = 파이프라인 재고 축적. */
  gap: number;
  /** gap 누적 — 시작점이 임의라 방향만 읽는다. */
  cumGap: number;
}

/** 시차 후보 1개. */
export interface LagCandidate {
  lagMonths: number;
  r: number;
  n: number;
}

/** 시차 탐지 결과. */
export interface LagResult {
  /** 채택 시차(개월). 양수 = 자사 매출이 상대 계열보다 **선행**. */
  lagMonths: number;
  /** 채택 시차의 상관계수 (YoY 증감률 기준). */
  r: number;
  /** 상관 계산에 쓰인 표본 수. */
  n: number;
  /** 전 시차 후보 (화면에 근거로 노출 — 블랙박스 금지). */
  candidates: LagCandidate[];
}

/** 자사 매출이 따라가는 후보 축. */
export type DriverAxis = 'production' | 'retail' | 'shipments';

/** 축 하나에 대한 시차 상관 프로파일. */
export interface DriverLagProfile {
  axis: DriverAxis;
  /** 화면 표기명 ('스텔란티스 북미 생산' 등). */
  axisLabel: string;
  /** 이 축의 원 주기. 분기 축은 시차도 분기 단위(3의 배수)로만 탐색된다. */
  granularity: 'month' | 'quarter';
  lag: LagResult | null;
  /** 표본 부족 등으로 계산 못 한 이유. lag가 null일 때만 채운다. */
  unavailableReason: string | null;
}

/**
 * "자사 매출은 시간을 두고 무엇을 따라가는가" 분석 결과.
 *
 * 3축(생산·소매·출하)에 대해 각각 시차별 상관을 구하고, |r|이 가장 큰 축을 leader로 뽑는다.
 */
export interface RevenueDriverAnalysis {
  profiles: DriverLagProfile[];
  /** |r| 최대 축. 표본이 아무 축에서도 안 나오면 null. */
  leader: DriverLagProfile | null;
  /** 이 분석을 어디까지 믿어야 하는지 — 화면에 반드시 함께 노출. */
  caveats: string[];
}

/**
 * 조건부 비율 + Wilson 95% 신뢰구간.
 *
 * 비율만 내놓으면 표본 15개짜리 59%가 사실처럼 읽힌다. 분자·분모·구간을 항상 함께 옮긴다.
 */
export interface ConditionalRate {
  /** 조건을 만족한 시점 중 결과가 '매출 감소'였던 횟수. */
  declines: number;
  /** 조건을 만족한 시점 수. */
  total: number;
  /** declines / total. total=0이면 0. */
  rate: number;
  /** Wilson 하한 (0~1). */
  ciLow: number;
  /** Wilson 상한 (0~1). */
  ciHigh: number;
}

/** 재고 방향이 자사 매출 방향에 대해 무엇을 시사하는가 — 축 1개분. */
export interface InventoryOutlook {
  key: 'monthly' | 'quarterly';
  /** '월별 생산−소매 기준' 등. */
  label: string;
  /** 재고 축적 국면 이후 매출이 감소한 비율. */
  building: ConditionalRate;
  /** 재고 소진 국면 이후 매출이 감소한 비율. */
  draining: ConditionalRate;
  /** 조건과 무관한 전체 감소율 — 비교 기준선. */
  base: ConditionalRate;
  /** 조건 정의 문장 ('직전 6개월 누적 생산−소매 > 0' 등). */
  conditionLabel: string;
  /** 결과 시점 문장 ('6개월 뒤 자사 매출 전년 동월 대비' 등). */
  outcomeLabel: string;
  /** 현재 국면. */
  currentState: 'building' | 'draining';
  /** 현재 국면이 이어진 기간 (월 또는 분기 — key에 따름). */
  currentStreak: number;
  /** 표본이 충분해 비율을 읽어도 되는지. false면 화면이 숫자를 강조하지 않는다. */
  hasEnoughSamples: boolean;
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

/** 스텔란티스 공장 가동 이벤트 (수동 큐레이션 — lib/stellantis-forecast/plant-events.ts). */
export interface PlantEvent {
  plant: string;
  country: 'USA' | 'Canada' | 'Mexico';
  /** YYYYMM */
  startYearMonth: number;
  /** YYYYMM. 진행 중이거나 단발이면 start와 동일. */
  endYearMonth: number;
  eventType: PlantEventType;
  models: string[];
  /** 한 문장 요약. */
  summary: string;
  /** 보도된 사유. */
  statedReason: string;
  /** 재고와의 관계 — 이 페이지의 관심사. */
  inventoryRelation: 'response_to_glut' | 'response_to_demand' | 'unrelated';
  sourceUrl: string;
  sourceName: string;
  /** YYYY-MM-DD. 기사에 발행일이 없어 확인 못 한 경우 null(추정 금지). */
  sourceDate: string | null;
}

/**
 * 공장 이벤트를 재고 국면에 붙인 결과.
 *
 * 이벤트가 "그때 재고가 어땠는가"와 함께 있어야 의미가 산다 — 감산이 재고 과잉에 대한 반응인지
 * 수요 대응인지는 이벤트 문구가 아니라 당시 갭의 부호가 말해준다.
 */
export interface PlantEventWithContext {
  event: PlantEvent;
  /** 이벤트 시작월의 직전 6개월 누적 갭(생산−소매). 데이터 범위 밖이면 null. */
  precedingCumGap: number | null;
  /** precedingCumGap의 부호. null이면 'unknown'. */
  precedingState: 'building' | 'draining' | 'unknown';
}

export type PlantEventType =
  | 'downtime'
  | 'shift_cut'
  | 'shift_add'
  | 'retooling'
  | 'layoff'
  | 'closure'
  | 'restart'
  | 'production_add'
  | 'other';

/** 페이지 전체 데이터. */
export interface StellantisForecastData {
  /** 차트 1 — 월별 생산 vs 소매. */
  monthlyFlow: MonthlyFlowPoint[];
  /** 차트 2 — 분기 출하 vs 소매 (실측 완전 분기만 — 통계·진단이 쓰는 계열). */
  gap: GapPoint[];
  /**
   * 진행 중인 최신 분기를 **소매 일부 추정**으로 채운 갭 (차트 2 표시 전용, 없으면 null).
   *
   * `gap`과 분리해 둔다 — 추정 분기는 화면에만 붙이고 통계·진단은 실측만 세도록.
   */
  gapProjected: GapPoint | null;
  /** 추정 분기 안내 문구 (어느 국가·월을 어떻게 추정했는지). null이면 추정 분기 없음. */
  projectedNote: string | null;
  /** 자사 매출이 무엇을 따라가는가. */
  drivers: RevenueDriverAnalysis;
  /** 재고 방향 → 매출 방향 확률 (월별·분기별 2종). */
  outlooks: InventoryOutlook[];
  /** 공장 가동 이벤트 + 당시 재고 국면 (최신순). */
  events: PlantEventWithContext[];
  diagnosis: Diagnosis;
  cox: CoxInventoryRow[];
  /** 3개국 생산·소매가 모두 채워진 마지막 월. 이후는 잠정이라 계산에서 제외했다. */
  lastCompleteMonth: number | null;
  /** 3개국 소매가 모두 채워진 마지막 분기. */
  lastCompleteQuarter: string | null;
  /** 잠정(부분 수집) 분기 라벨 — 화면 각주용. null이면 없음. */
  partialQuarterNote: string | null;
}
