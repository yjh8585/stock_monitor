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

/** 자사 Stellantis NA향 월별 매출 (사외비 pnl_entries에서 추출, 억원). */
export interface RevenueMonthRow {
  year_month: number;
  /** 억원. 원본이 null이면 행 자체를 만들지 않는다. */
  revenueEok: number;
}

/**
 * `cox_brand_inventory` 한 행 — Cox 집계 브랜드별 미국 딜러 재고일수(월).
 *
 * 공장 동향의 '재고' 이벤트를 이 표에서 **자동 생성**한다(수동 큐레이션 아님).
 */
export interface CoxInventoryRow {
  brand: string;
  year_month: number;
  /** 재고일수. NATION(업계 평균)×2 초과로 Cox가 차트에서 제외한 브랜드는 null(값 없음이 아니라 신호). */
  days_supply: number | null;
  is_outlier_excluded: boolean;
  source_url: string | null;
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

/** KPI 값 카드 지표 키. */
export type KpiMetricKey = 'retail' | 'shipments' | 'revenue';

/**
 * KPI 값 카드 하나 (소매 판매 · 출하량 · 스텔란티스향 매출).
 *
 * 당해 연도 누적(YTD)을 전년 **같은 기간**과 비교한다. YoY 증가율이 주 지표이고 절대값 변화는 보조.
 * revenue는 사외비(억원)라 인증 사용자에게만 표시된다.
 */
export interface KpiMetric {
  key: KpiMetricKey;
  label: string;
  /** 비교 기간 라벨 ('2026 상반기 (Q1~Q2)' · '2026.1~5월 누적'). */
  periodLabel: string;
  /** 당해 YTD 값. */
  currentValue: number;
  /** 전년 동기간 값. */
  priorValue: number;
  /** 전년 대비 증감률(%). 전년 데이터 없거나 0이면 null. */
  yoyPct: number | null;
  /** 절대값 변화 (current − prior). */
  absChange: number;
  /** 단위 — 대(units) 또는 억원(eok). */
  unit: 'units' | 'eok';
  /** 데이터가 있어 값을 표시해도 되는지. */
  available: boolean;
}

/** 신호등 3색. */
export type TrafficLight = 'red' | 'yellow' | 'green';

/**
 * 재고 증감 KPI — 신호등.
 *
 * 재고가 쌓이면(출하 > 소매) 향후 감산 → 당사 매출 하방이라 **빨강**, 재고가 줄면 **초록**,
 * 방향이 뚜렷하지 않으면 **노랑**. 서술은 "N분기 연속 재고 증가"처럼 간단히.
 */
export interface InventoryKpi {
  label: string;
  status: TrafficLight;
  /** 한 줄 요약 ('3분기 연속 재고 증가'). */
  headline: string;
  /** 왜 이 색인지 짧은 설명. */
  detail: string;
  /** 같은 방향이 이어진 분기 수. */
  consecutiveQuarters: number;
  direction: 'building' | 'draining' | 'flat';
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
  // '재고' — 공장이 아니라 미국 딜러 네트워크의 재고 지표(Cox 재고일수 등). 화면에서 음영 강조.
  | 'inventory'
  | 'other';

/** 페이지 전체 데이터. */
export interface StellantisForecastData {
  /** 차트 2 — 월별 생산 vs 소매. */
  monthlyFlow: MonthlyFlowPoint[];
  /** 차트 1 — 분기 출하 vs 소매 (실측 완전 분기만). */
  gap: GapPoint[];
  /**
   * 진행 중인 최신 분기를 **소매 일부 추정**으로 채운 갭 (차트 1 표시 전용, 없으면 null).
   *
   * `gap`과 분리해 둔다 — 추정 분기는 화면에만 붙이고 KPI/통계는 실측 계열을 기준으로.
   */
  gapProjected: GapPoint | null;
  /** 추정 분기 안내 문구 (어느 국가·월을 어떻게 추정했는지). null이면 추정 분기 없음. */
  projectedNote: string | null;
  /** KPI 값 카드 3종 (소매 판매 · 출하량 · 스텔란티스향 매출) — YTD YoY. */
  kpiMetrics: KpiMetric[];
  /** 재고 증감 KPI (신호등). */
  kpiInventory: InventoryKpi;
  /** 공장 가동 이벤트 + 당시 재고 국면 (최신순). */
  events: PlantEventWithContext[];
  /** 3개국 생산·소매가 모두 채워진 마지막 월. 이후는 잠정이라 계산에서 제외했다. */
  lastCompleteMonth: number | null;
  /** 3개국 소매가 모두 채워진 마지막 분기. */
  lastCompleteQuarter: string | null;
  /** 잠정(부분 수집) 분기 라벨 — 화면 각주용. null이면 없음. */
  partialQuarterNote: string | null;
}
