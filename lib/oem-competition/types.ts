/** 시장별 분해 — oem_model_outlook.market_breakdown (JSONB) 페이로드. */
export interface MarketBreakdown {
  market: string;
  label: string;
  sales: number;
  yoy_pct: number | null;
  share_pct: number | null;
  prev_share_pct: number | null;
  /** 집계 기준월(YYYYMM)과 누계 개월 수 — 2026-08-13 이전 적재분에는 없다. */
  anchor_month?: number | null;
  months?: number | null;
  comment: string;
}

/** Perplexity 출처 — oem_model_outlook.sources (JSONB) 페이로드. */
export interface OutlookSource {
  title: string;
  url: string;
  date: string;
}

/** 경쟁 차종 1건의 동기간 판매·증감 — metrics.markets[].competitors 페이로드. */
export interface CompetitorSales {
  model: string;
  sales: number;
  yoy_pct: number | null;
}

/**
 * Cox 딜러 **유통재고**일수 — 브랜드 단위(차종 아님). 미국 딜러 판매점에 깔린 미판매 신차 기준이고
 * 공장 재고가 아니다.
 *
 * 🔴 `outlierExcluded` 가 곧 위험 신호다. Cox 는 업계 평균의 **2배를 넘는 브랜드의 수치를 아예
 * 공개하지 않는다** — 값이 없다는 건 "모른다"가 아니라 "너무 높아서 안 실었다"는 뜻이다. 그래서
 * `days_supply` 에는 **마지막으로 공개된 값**을 남기고(비교 막대가 사라지지 않게), 그 값이 이미
 * 지난 달의 것임을 이 플래그로 알린다. 상세는 docs/gotchas-data-collection.md 의 Cox 절.
 */
export interface InventoryPoint {
  /** 대상 차종 자신은 model 이 없다(브랜드만 안다). */
  model?: string;
  brand: string;
  /** 마지막으로 공개된 재고일수. Cox 로스터에 아예 없는 브랜드면 null. */
  days_supply: number | null;
  year_month: number;
  /** 그 직전 공개월 값 — 증감 표기용. 없으면 비교 불가. */
  prevDaysSupply?: number | null;
  prevYearMonth?: number | null;
  /** Cox 최신 집계월에서 이 브랜드가 이상치로 제외됐는가(= 평균 2배 초과, 수치 미공개). */
  outlierExcluded?: boolean;
  /** 이상치 제외가 시작된 월(YYYYMM). 화면 문구에 "2026.06부터 미공개"로 쓴다. */
  outlierMonth?: number | null;
}

/** NHTSA 리콜 부품군 집계 한 줄 — [부품명, 건수]. 수집기 `summarize_recalls` 형식 그대로. */
export type ComponentCount = [string, number];

/** NHTSA 리콜·불만. complaint_count 는 조회 실패 시 null(=0 이 아니라 '알 수 없음'). */
export interface SafetyPoint {
  model?: string;
  model_year: number;
  recall_count: number;
  complaint_count: number | null;
  /** 대상 차종만 — 리콜이 몰린 부품군 상위. 경쟁 차종은 건수만 수집한다. */
  recallComponents?: ComponentCount[];
  /** 대상 차종만 — 최근 리콜 요약(최대 2건). */
  recallSummaries?: string[];
  /** 대상 차종만 — 불만이 몰린 부품군 상위. 수집기 확장 이전 적재분에는 없다. */
  complaintComponents?: ComponentCount[];
}

/** 소비자 평가 5축 점수(1~5). 축 키는 수집기 CONSUMER_AXIS_KEYS 와 일치해야 한다. */
export interface ConsumerScore {
  model: string;
  is_target: boolean;
  design: number;
  price: number;
  quality: number;
  efficiency: number;
  brand: number;
}

/** 레이더 축 정의 — 표시 순서가 곧 오각형 꼭짓점 순서다. */
export const CONSUMER_AXES = [
  { key: 'design', label: '상품성·디자인' },
  { key: 'price', label: '가격 경쟁력' },
  { key: 'quality', label: '품질·신뢰도' },
  { key: 'efficiency', label: '연비·전동화' },
  { key: 'brand', label: '브랜드·잔존가치' },
] as const satisfies ReadonlyArray<{
  key: keyof Omit<ConsumerScore, 'model' | 'is_target'>;
  label: string;
}>;

export type ConsumerAxisKey = (typeof CONSUMER_AXES)[number]['key'];

/**
 * 신차 사이클 한 줄 — oem_model_outlook.model_cycle (JSONB) 페이로드.
 *
 * 🔴 **두 연식을 모두 들고 다니는 이유**: 실측(2026-08-14)에서 그랜드체로키는 2021년 완전변경
 * 이후 5년차인데 2026년에 페이스리프트를 받았고, 경쟁 Traverse·Grand Highlander 는 2024년
 * 완전변경으로 2년차다. "마지막 개선 이후 경과"만 보면 그랜드체로키가 **가장 신선해** 보이지만,
 * 세대(플랫폼) 나이로는 가장 늙었다. 어느 한쪽만 쓰면 정반대 결론이 나온다.
 */
export interface ModelCycleEntry {
  model: string;
  isTarget: boolean;
  /** 현행 세대가 처음 나온 연식(완전변경). */
  lastFullChange: number;
  /** 마지막 상품성 개선 연식. 개선이 없었으면 lastFullChange 와 같다. */
  lastUpdate: number;
  /** '완전변경' | '페이스리프트' | '연식변경' — AI 판정이라 열거로 좁히지 않는다. */
  lastUpdateType: string;
  nextEventType: string;
  nextEventTiming: string;
  note: string;
}

/** 월별 판매 1점 — oem_competition_monthly_view 행. */
export interface MonthlyPoint {
  yearMonth: number;
  sales: number;
  /** 전년 동월 대비 증감률(%). 12개월 전 실적이 없거나 0이면 null. */
  yoyPct: number | null;
}

/**
 * 집계 기준 — 화면 버튼 2개와 1:1 대응한다.
 * `L12M` 최근 12개월 누계(계절성 제거) · `YTD` 올해 1월~기준월 누계(연초 이후 흐름).
 */
export type PeriodBasis = 'L12M' | 'YTD';

/** 한 기준에서 차종 하나의 판매·점유율. 대상은 여러 표기명을 합산한 1건으로 온다. */
export interface PeriodModelSales {
  model: string;
  isTarget: boolean;
  sales: number;
  prevSales: number;
  yoyPct: number | null;
  sharePct: number;
  /** 전년 동기 점유율. 전년 실적이 없으면 null(0 으로 뭉개지 않는다). */
  prevSharePct: number | null;
}

/**
 * 한 시장 × 한 기준의 재집계. 월별 뷰에서 화면이 직접 계산한다.
 *
 * 저장값(`market_breakdown`)은 수집 시점의 12개월 누계 한 벌뿐이라 YTD 버튼을 만들 수 없다.
 * 같은 앵커월·같은 창 규칙을 쓰므로 `L12M` 은 저장값과 일치해야 한다(어긋나면 둘 중 하나가 버그다).
 */
export interface PeriodAggregate {
  basis: PeriodBasis;
  /** 버튼·부제에 그대로 쓰는 표기 — "최근 12개월" · "2026년 누계(1~6월)" */
  label: string;
  anchorMonth: number;
  months: number;
  /** 대상 + 경쟁 전 차종, 판매 내림차순. */
  models: PeriodModelSales[];
  totalSales: number;
  prevTotalSales: number;
}

/** 한 시장에서 한 차종의 월별 시계열. */
export interface ModelSeries {
  model: string;
  isTarget: boolean;
  points: MonthlyPoint[];
}

/**
 * 점유율 시계열 1점 — **12개월 이동 누계 기준**이다.
 *
 * 단월 점유율을 쓰면 경쟁차 한 종이 그달 실적을 아직 안 올렸을 때 분모가 줄어 대상 점유율이
 * 가짜로 치솟는다. 이동 누계는 그 결측을 12개월에 나눠 흡수하고, 계절성도 상쇄되며,
 * 무엇보다 KPI·스코어보드가 쓰는 L12M 정의와 **같은 수치**가 된다(끝점이 KPI와 일치한다).
 */
export interface ShareTrendPoint {
  yearMonth: number;
  /** 12개월 창이 다 차지 않은 구간은 null(0 으로 그리면 "점유율 0%"가 사실처럼 보인다). */
  sharePct: number | null;
}

export interface ModelShareTrend {
  model: string;
  isTarget: boolean;
  points: ShareTrendPoint[];
}

/**
 * 브랜드 재고일수 시계열 1점.
 * `daysSupply=null` + `outlierExcluded=true` 는 "모른다"가 아니라 **평균 2배 초과라 Cox 가
 * 값을 감췄다**는 뜻이다 — 선을 끊고 그 구간을 따로 표시해야 한다.
 */
export interface InventoryTrendPoint {
  yearMonth: number;
  daysSupply: number | null;
  outlierExcluded: boolean;
}

export interface BrandInventoryTrend {
  brand: string;
  /** 경쟁 차종만 — 대상은 브랜드만 안다. */
  model?: string;
  isTarget: boolean;
  points: InventoryTrendPoint[];
}

/**
 * 시장 하나에 필요한 모든 표시 데이터.
 * 서술(comment)·집계(sales/share)·비교(competitors/inventory/safety/scores)를 한 덩어리로 묶어
 * 컴포넌트가 여러 소스를 다시 짜맞추지 않게 한다.
 */
export interface CompetitionMarket {
  market: string;
  label: string;
  comment: string;
  /** 집계 기준월(YYYYMM)·누계 개월 — "월간 실적"으로 오해되지 않도록 화면에 함께 쓴다. */
  anchorMonth: number | null;
  months: number | null;
  sales: number;
  yoyPct: number | null;
  sharePct: number | null;
  prevSharePct: number | null;
  segmentNote: string | null;
  competitors: CompetitorSales[];
  /** [0]=대상 차종. 매핑이 없거나 Cox 미보유 브랜드면 비어 있다. */
  inventory: InventoryPoint[];
  safety: SafetyPoint[];
  consumerScores: ConsumerScore[];
  /** 대상 + 판매 상위 경쟁 3종의 월별 추이. */
  series: ModelSeries[];
  /** 같은 4종의 **경쟁군 내 점유율** 추이(12개월 이동 누계). 월별 뷰가 없으면 빈 배열. */
  shareTrend: ModelShareTrend[];
  /** 대상 브랜드 + 경쟁 브랜드의 유통재고일수 추이. 미국 기준 시장에서만 채워진다. */
  inventoryTrend: BrandInventoryTrend[];
  /** 대상 + 경쟁 상위 3종의 세대 연식. 2026-08-14 이전 적재분에는 없다(빈 배열). */
  modelCycle: ModelCycleEntry[];
  /** 기준별 재집계(월별 뷰 기반). 뷰에 그 시장 데이터가 없으면 빈 배열. */
  periods: PeriodAggregate[];
  /**
   * 미국 전용 지표(Cox 유통재고·NHTSA)가 이 시장에 어떤 자격으로 붙었는가.
   * `native` 시장 자체가 미국이라 그 시장의 사실 · `reference` 글로벌 시장에 붙인 **미국 참고치**
   * (사용자 결정 2026-08-14: 표시는 하되 신호등 판정에서 제외) · `null` 해당 지표 없음.
   */
  usMetricsBasis: 'native' | 'reference' | null;
}

export interface CompetitionOutlook {
  modelKey: string;
  modelName: string;
  oemGroup: string;
  noteDate: string;
  label: 'GREEN' | 'YELLOW' | 'RED';
  salesTrend: string | null;
  competitiveView: string | null;
  consumerView: string;
  outlook: string;
  rationale: string;
  /** 화면 표시용으로 합쳐진 시장 목록(display_order 순). */
  markets: CompetitionMarket[];
  sources: OutlookSource[];
}
