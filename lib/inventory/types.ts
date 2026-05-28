/** 재고(/management/inventory) 도메인 타입. */

export type InventoryKind = 'plan' | 'actual';

/** inventory_entries 테이블 row */
export interface InventoryRow {
  category: string;
  item: string;
  kind: InventoryKind;
  period_year: number;
  period_month: number;
  unit: string | null;
  fx_rate: number | null;
  value: number | null;
}

/** 차트 1 (재고 현황) 월별 누적막대 + 회전율 포인트. 단위 = 억원. */
export interface StatusMonthPoint {
  /** 표시 라벨 ('2025.01', '2025.02', ...) */
  monthLabel: string;
  year: number;
  month: number;
  /** 4개 분류 (원화 환산 완료, 억원) */
  operating: number | null;
  management: number | null;
  compensation: number | null;
  /** 운송 = 영업 재고 + 미국 운송(환산) + 우즈벡 운송(환산) */
  transport: number | null;
  /** 합계 (data label용) */
  total: number | null;
  /** 회전율 (회) — 실적만 존재 */
  turnover: number | null;
}

/** 차트 2/3 (계획대비 실적) 월별 포인트. */
export interface AchievementMonthPoint {
  monthLabel: string;
  year: number;
  month: number;
  plan: number | null;
  actual: number | null;
  /** 달성율 % = actual/plan*100. plan 0/null이면 null */
  rate: number | null;
}

/** KPI 카드 데이터 (최신 실적 월 기준). */
export interface InventoryKpis {
  /** 최신 실적 월 라벨 (예: '2026.04') */
  latestLabel: string;
  /** 1. 전체 재고 (억원) + 전월 대비 변화율(%) */
  totalEok: number | null;
  totalMomPct: number | null;
  /** 2. 회전율 (회) + 회전기간(일) */
  turnover: number | null;
  turnoverDays: number | null;
  /** 3. 관리 비중 (관리/전체 × 100, %) */
  managementSharePct: number | null;
  /** 4. 보상 비중 (보상/전체 × 100, %) */
  compensationSharePct: number | null;
  /** 5. 운송 비중 (운송/전체 × 100, %) */
  transportSharePct: number | null;
}

/** 차트 2 토글 옵션. */
export type AchievementCategory =
  | 'total'
  | 'operating'
  | 'management'
  | 'compensation'
  | 'transport';

/** 차트 3 토글 옵션. */
export type TransportItem = 'us' | 'uz' | 'sales';
