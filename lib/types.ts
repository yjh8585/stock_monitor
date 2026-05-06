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
  fx_to_krw: number | null;
  financials_by_year: Record<string, FinancialYear> | null;
}

/** 정렬 키 */
export type SortKey =
  | 'company_type'
  | 'name_kr'
  | 'region'
  | 'rev_2022'
  | 'rev_2023'
  | 'rev_2024'
  | 'rev_2025'
  | 'cagr'
  | 'op_2023'
  | 'op_2024'
  | 'op_2025'
  | 'debt_ratio'
  | 'inv_turnover'
  | 'last_price'
  | 'market_cap_t'
  | 'per'
  | 'pbr'
  | 'ev_ebitda';

export type SortDir = 'asc' | 'desc';
