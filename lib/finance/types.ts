/** 재무(/management/finance) 도메인 타입. 단위: UI는 억원(= value_mwon / 100). */

export type FinancePeriodKind = 'annual' | 'monthly';

/** finance_entries 테이블 row (백만원). */
export interface FinanceRow {
  subsidiary: string;
  consolidation: string;
  period_year: number;
  period_kind: FinancePeriodKind;
  period_month: number;
  account: string;
  value_mwon: number | null;
}

/** 차트 1 (재무 레버리지) 시점별 포인트. 단위 = 억원. */
export interface LeveragePoint {
  /** 표시 라벨 ('2023','2024','2025','2026.05') */
  periodLabel: string;
  year: number;
  /** 당해연도 최신월(YTD) 여부 — 과거 연말이면 false */
  isYtd: boolean;
  /** 자산 (억원) */
  assets: number | null;
  /** 부채 (억원) */
  liabilities: number | null;
  /** 부채비율(%) = 부채 / 자본(자기자본) × 100 */
  debtRatio: number | null;
}

/** 차트 2 (투하자본·자금조달) 표의 한 행. */
export interface CapitalRow {
  key: string;
  label: string;
  /** 들여쓰기 레벨 (0 섹션/합계, 1 소계, 2 상세) */
  level: 0 | 1 | 2;
  /** 행 종류 — 스타일 분기용 */
  kind: 'section' | 'subtotal' | 'total' | 'detail';
  /** 차감 항목(채무) — 라벨에 (차감) 표시, 순운전자본에서 차감 */
  subtract?: boolean;
  /** 기간별 값 (periods와 동일 순서, 억원). 섹션 헤더는 전부 null. */
  values: (number | null)[];
}

/** 차트 2 표 전체. */
export interface CapitalTable {
  /** 기간 라벨 (['2023','2024','2025','2026.05']) */
  periods: string[];
  rows: CapitalRow[];
}

/** 구간 증감(절대값·증감률). */
export interface FinanceDelta {
  abs: number | null;
  pct: number | null;
}
