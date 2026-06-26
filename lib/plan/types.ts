/** 손익 계획(pnl_plan) 도메인 타입. */
import type { Basis } from '@/lib/pnl/types';

export type PlanKind = 'plan' | 'actual';
export type PeriodType = 'annual' | 'month';

/** pnl_plan 테이블 row */
export interface PlanRow {
  category: string;
  item: string;
  basis: Basis;
  kind: PlanKind;
  period_year: number;
  period_type: PeriodType;
  period_month: number;
  unit: string;
  value: number | null;
}

/** 콤보 차트 1개 연도 포인트 */
export interface AchievementPoint {
  /** 표시 라벨 ('2025' | '2026 YTD') */
  yearLabel: string;
  year: number;
  /** YTD(진행 연도)면 true */
  ytd: boolean;
  plan: number | null;
  actual: number | null;
  /** 달성율 % = actual/plan*100. plan 0/null이면 null */
  rate: number | null;
  /** 계획 영업이익률 % = 영업이익계획/매출계획*100. 영업이익 차트에서만 부여(그 외 undefined) */
  marginPlan?: number | null;
  /** 실적 영업이익률 % = 영업이익실적/매출실적*100. 영업이익 차트에서만 부여(그 외 undefined) */
  marginActual?: number | null;
}
