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

/** /domestic 페이지 행: company_type/region 대신 group_name + sales_rank */
export interface DomesticStockRow {
  id: string;
  ticker: string | null;
  name: string;
  name_kr: string;
  market: string | null;
  country: string;
  currency: string;
  status: string;
  group_name: string | null;
  products: ProductItem[];
  customers: CustomerItem[];
  last_price: number | null;
  last_change_pct: number | null;
  last_updated_at: string | null;
  market_cap: number | null;
  business_summary: string | null;
  summary_updated_at: string | null;
  homepage_url: string | null;
  fx_to_krw: number | null;
  fx_fin_to_krw: number | null;
  financials_by_year: Record<string, FinancialYear> | null;
  latest_quarter: LatestQuarter | null;
  /** 최근 연도 매출 KRW환산 (정렬용 내부 키) */
  latest_revenue_krw: number | null;
  /** ROW_NUMBER OVER (ORDER BY 매출 DESC) — 1=매출 1위 */
  sales_rank: number | null;
}

/** /domestic 정렬 키 (구분/지역 제거 + 그룹/매출순위 추가) */
export type DomesticSortKey =
  | 'group_name'
  | 'sales_rank'
  | 'name_kr'
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

// ============================================================
// /oem 페이지 — MarkLines 글로벌 OEM 판매량 차트
// ============================================================

/** PowerTrain 정규화 6종 (적재 스크립트와 동일) */
export type PowerTrain = 'ICE' | 'HV' | 'PHEV' | 'EV' | 'FCV' | 'Other';

/** oem_sales_group_month 한 행 */
export interface OemSalesGroupMonth {
  oem_group: string;
  year_month: number; // YYYYMM
  sales: number;
}

/** oem_sales_group_pt_month 한 행 */
export interface OemSalesGroupPtMonth {
  oem_group: string;
  powertrain: PowerTrain | string;
  year_month: number;
  sales: number;
}

/** oem_sales_group_country_month 한 행 */
export interface OemSalesGroupCountryMonth {
  oem_group: string;
  country: string;
  year_month: number;
  sales: number;
}

/** oem_sales_type_seg_month 한 행 */
export interface OemSalesTypeSegMonth {
  vehicle_type: string;
  segment: string;
  year_month: number;
  sales: number;
}

/** OEM 순위 행 (TOP30 YTD / TOP40 등 공통) */
export interface OemRankRow {
  rank: number;
  oem_group: string;
  sales: number;
  /** 비교 기간(전년 등) 판매량 — YoY 계산용 */
  sales_prev: number;
  /** YoY 변화율 (%, sales_prev=0이면 null) */
  yoy: number | null;
  /** 비교 기간 순위 — 등락 표시용 */
  rank_prev?: number;
  /** 순위 등락 (양수=상승, 음수=하락, 0=유지, null=신규/소실) */
  rank_change?: number | null;
}
