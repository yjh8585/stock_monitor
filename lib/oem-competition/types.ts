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

/** Cox 딜러 재고일수 — 브랜드 단위(차종 아님). 미국 시장 기준. */
export interface InventoryPoint {
  /** 대상 차종 자신은 model 이 없다(브랜드만 안다). */
  model?: string;
  brand: string;
  days_supply: number;
  year_month: number;
}

/** NHTSA 리콜·불만. complaint_count 는 조회 실패 시 null(=0 이 아니라 '알 수 없음'). */
export interface SafetyPoint {
  model?: string;
  model_year: number;
  recall_count: number;
  complaint_count: number | null;
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

/** 월별 판매 1점 — oem_competition_monthly_view 행. */
export interface MonthlyPoint {
  yearMonth: number;
  sales: number;
}

/** 한 시장에서 한 차종의 월별 시계열. */
export interface ModelSeries {
  model: string;
  isTarget: boolean;
  points: MonthlyPoint[];
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
