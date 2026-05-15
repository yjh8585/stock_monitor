/**
 * 손익(P&L) 도메인 타입 정의.
 *
 * - `pnl_entries` 테이블 row 1:1 매핑
 * - 매출총이익(gross_profit)은 derived (revenue - material_cost - labor_cost - expense) 이므로 컬럼 없음
 * - 사용자 요구: 매출총이익 컬럼은 표에 노출하지 않음
 */

/** 연결/별도 기준 */
export type Basis = 'consolidated' | 'standalone';

/** `pnl_entries` 테이블 row */
export interface PnlEntry {
  basis: Basis;
  /** 원본 라벨 보존: '2023' | '2024' | '2025' | '2025(E)' | '2026' | '2026(P)' 등 */
  year_label: string;
  period_year: number;
  /** 0 = 연간 합계, 1~12 = 월별 */
  period_month: number;
  is_plan: boolean;
  is_estimate: boolean;
  sil: string;
  division: string;
  factory: string;
  product: string;
  customer: string;
  revenue: number | null;
  material_cost: number | null;
  labor_cost: number | null;
  expense: number | null;
  sga: number | null;
  rnd: number | null;
  op_income: number | null;
}

/** 7개 지표 키 (매출총이익 제외) */
export type MetricKey =
  | 'revenue'
  | 'material_cost'
  | 'labor_cost'
  | 'expense'
  | 'sga'
  | 'rnd'
  | 'op_income';

/** 표 헤더용 한글 라벨 */
export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: '매출',
  material_cost: '재료비',
  labor_cost: '노무비',
  expense: '경비',
  sga: '판관비',
  rnd: '연구비',
  op_income: '영업이익',
};

/** 매출 대비 %를 함께 노출하는 지표 (매출 자체는 % 없음) */
export const METRICS_WITH_RATIO: ReadonlySet<MetricKey> = new Set<MetricKey>([
  'material_cost',
  'labor_cost',
  'expense',
  'sga',
  'rnd',
  'op_income',
]);

/** 7개 지표 표시 순서 */
export const METRIC_ORDER: readonly MetricKey[] = [
  'revenue',
  'material_cost',
  'labor_cost',
  'expense',
  'sga',
  'rnd',
  'op_income',
];

/** 집계 차원 키 */
export type DimensionKey = 'sil' | 'division' | 'factory' | 'product' | 'customer';

/** 집계 결과 1행 (차원 + 7개 지표 합계) */
export interface AggregatedRow {
  /** 차원 값 join 결과 — 단일 차원이면 그 값, 복합 차원이면 "A | B" */
  key: string;
  /** 각 차원별 raw 값 (멀티 차원에서 컬럼 분해 시 사용) */
  dims: Record<DimensionKey, string>;
  revenue: number;
  material_cost: number;
  labor_cost: number;
  expense: number;
  sga: number;
  rnd: number;
  op_income: number;
}
