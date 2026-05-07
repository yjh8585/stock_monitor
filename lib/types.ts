/** 연간 재무 데이터 (financials 테이블 annual 행) */
export interface FinancialYear {
  revenue: number | null;
  operating_income: number | null;
  operating_margin: number | null;
  total_liabilities: number | null;
  total_equity: number | null;
  debt_ratio: number | null;
  inventory: number | null;
  eps: number | null;
  per: number | null;
  pbr: number | null;
  ev_ebitda: number | null;
}

export interface ProductItem {
  name: string;
  share_pct?: number;
}

export interface CustomerItem {
  name: string;
  logo_url?: string;
}

/** 가장 최근 분기 실적 (전년 동기 비교용 prev_* 포함) */
export interface LatestQuarter {
  fiscal_year: number;
  fiscal_quarter: number;
  revenue: number | null;
  operating_income: number | null;
  operating_margin: number | null;
  /** 전년 동기 매출 (YOY 계산용) */
  prev_revenue: number | null;
  /** 전년 동기 영업이익 (YOY 계산용) */
  prev_operating_income: number | null;
  /** 전년 동기 영업이익률 (pp 차이 계산용) */
  prev_operating_margin: number | null;
}

/** related_stocks_view 한 행 */
export interface RelatedStockRow {
  id: string;
  ticker: string | null;
  name: string;
  name_kr: string;
  market: string | null;
  country: string;
  currency: string;
  status: string;
  company_type: 'OEM' | '부품사' | null;
  region: string | null;
  products: ProductItem[];
  customers: CustomerItem[];
  last_price: number | null;
  last_change_pct: number | null;
  last_updated_at: string | null;
  market_cap: number | null;
  business_summary: string | null;
  summary_updated_at: string | null;
  homepage_url: string | null;
  /** 주가/시총 환산용 — companies.currency 기준 (1단위 → KRW) */
  fx_to_krw: number | null;
  /** 재무제표 환산용 — financials.currency 기준 (VFS처럼 주가/재무 통화가 다를 때) */
  fx_fin_to_krw: number | null;
  financials_by_year: Record<string, FinancialYear> | null;
  latest_quarter: LatestQuarter | null;
}

/** 정렬 키 — rev_YYYY / op_YYYY 는 동적 연도를 지원하는 template literal */
export type SortKey =
  | 'company_type'
  | 'name_kr'
  | 'region'
  | `rev_${string}`
  | 'cagr'
  | `op_${string}`
  | 'debt_ratio'
  | 'inv_turnover'
  | 'last_price'
  | 'market_cap_t'
  | 'per'
  | 'pbr'
  | 'ev_ebitda';

export type SortDir = 'asc' | 'desc';

/** 통화 환율 (1단위 → KRW) */
export interface ExchangeRates {
  USD: number | null;
  EUR: number | null;
  CNY: number | null;
}

/** 뉴스 항목 (news 테이블 한 행) */
export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string | null;
  published_at: string;
}
