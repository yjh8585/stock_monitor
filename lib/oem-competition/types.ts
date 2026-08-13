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
  markets: MarketBreakdown[];
  sources: OutlookSource[];
}
