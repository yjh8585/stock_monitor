/** 고객사 페이지 도메인 타입 — 순수 함수(share·earnings·prices·volume)와 source 가 공유한다. */

/** 손익 매출 한 행(연결·실적·1~12월로 호출부가 이미 거른 것). */
export interface PnlRevenueRow {
  customer: string;
  product: string;
  period_year: number;
  period_month: number;
  revenue: number | null;
}

export interface ShareAccount {
  company_id: string;
  pnl_customers: string[];
}

export interface CustomerShare {
  /** 최근 12개월 우리 연결 매출 중 이 회사 비중(%). 손익 고객 행이 없으면 null(「해당 없음」). */
  sharePct: number | null;
  /** 매출 상위 품목(최대 3) — 사외비. */
  topProducts: string[];
}

export interface ShareResult {
  /** 예: '2025.10~2026.09'. 손익 행이 없으면 ''. */
  windowLabel: string;
  byCompany: Record<string, CustomerShare>;
}

/** financials 한 행 중 실적에 쓰는 칸. 금액 = 원통화 백만. */
export interface FinancialPeriodRow {
  fiscal_year: number;
  fiscal_quarter: number | null;
  period_type: string;
  period_end_date: string | null;
  currency: string;
  revenue: number | null;
  operating_income: number | null;
  operating_margin: number | null;
  net_income: number | null;
}

/** 실적 표·차트 한 점. 금액 = 현지 통화 십억(bn). */
export interface CustomerEarningsPoint {
  period_label: string;
  fiscal_year: number;
  fiscal_quarter: number | null;
  revenue_bn: number | null;
  operating_income_bn: number | null;
  operating_margin_pct: number | null;
  net_income_bn: number | null;
  /** 전년 같은 기간 대비 매출 증감(%). 비교 대상이 없으면 null. */
  revenue_yoy_pct: number | null;
  /** 칸마다 출처(해외만 · pickEarnings). 없으면 1단계 그대로(financials). */
  origin?: EarningsOrigin;
  /** 그 분기 회사 발표 조정 영업이익(회사 이름 그대로). */
  adjusted?: { metric: string; name: string; value_bn: number }[];
}

export interface CustomerEarnings {
  /** 표·차트에 쓴 통화. 재무 행이 없으면 null. */
  currency: string | null;
  quarterly: CustomerEarningsPoint[];
  annual: CustomerEarningsPoint[];
}

export interface PricePoint {
  trade_date: string; // 'YYYY-MM-DD'
  close: number;
}

export interface PriceReturns {
  lastClose: number | null;
  lastDate: string | null;
  /** 마지막 종가 vs 한 달 전 날짜 이전 마지막 거래일 종가, %. */
  return1mPct: number | null;
  /** 마지막 종가 vs 전년 마지막 거래일 종가, %. */
  returnYtdPct: number | null;
}

/** 칸의 출처. 회사 장부상 → 회사 조정 영업이익 → 시장 데이터(yfinance) → 없음(「미발표」). */
export type EarningsSource = 'company_reported' | 'company_adjusted' | 'market' | 'none';

export interface CumulativeNote {
  period: string; // 2025-6M · 2025
  metric_name: string;
  basis: 'reported' | 'adjusted';
  value_bn: number;
}

export interface CellOrigin {
  source: EarningsSource;
  /** 회사 누계 차이로 계산한 분기(H1 − Q1 등). */
  derived?: boolean;
  /** 회사가 쓴 이름(조정 지표일 때 각주에 그대로). */
  metric_name?: string;
  /** source='market' 일 때 같은 해 회사 발표 누계(반기·연간) — 각주 「회사 발표 반기 값 …」. */
  company_cumulative?: CumulativeNote[];
  /**
   * 순이익 칸에만 — 출처마다 정의가 다르다. 회사 `net_income` = 세후 합계(비지배지분 포함) 'total' ·
   * 회사 `net_income_parent`·시장(yfinance) = 지배주주 귀속 'parent'. 출처가 바뀌면 라벨도 바뀌어야 한다(폭스바겐 등).
   */
  definition?: 'total' | 'parent';
}

export interface EarningsOrigin {
  revenue: CellOrigin;
  operating_income: CellOrigin;
  net_income: CellOrigin;
}
