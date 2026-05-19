/**
 * 재무 비교 페이지(/compare)에서 사용하는 지표·상수·타입.
 * client-safe (no 'use cache') — 클라이언트 컴포넌트가 직접 import할 수 있다.
 */

export interface CompareCompany {
  id: string;
  name_kr: string;
}

/** 비교 페이지 기준 회사 — 항상 기준 라인으로 표시 (다른 회사를 추가하려면 DB pages='compare' 등록) */
export const FIXED_PRIMARY_NAME = '한세모빌리티';

export interface FinancialRow {
  fiscal_year: number;
  revenue: number | null;
  operating_income: number | null;
  cogs: number | null;
  sga: number | null;
  inventory: number | null;
  net_income: number | null;
  ebitda: number | null;
  total_assets: number | null;
  total_liabilities: number | null;
  total_equity: number | null;
  labor_cost: number | null;
}

export type MetricUnit = 'percent' | 'times' | 'million';

export interface MetricDefinition {
  id: string;
  label: string;
  unit: MetricUnit;
  /** 단일 row에서 지표 값 계산. 분모 0/누락 시 null. */
  compute: (row: FinancialRow) => number | null;
  /** 표시 소수 자리수 override. 미지정 시 unit 기본값(percent=1, times=2). */
  digits?: number;
}

const ratio = (num: number | null, denom: number | null): number | null => {
  if (num == null || denom == null || denom === 0) return null;
  return num / denom;
};

export const COMPARE_METRICS: readonly MetricDefinition[] = [
  { id: 'revenue', label: '매출', unit: 'million', compute: (r) => r.revenue },
  {
    id: 'operating_margin',
    label: '영업이익률',
    unit: 'percent',
    compute: (r) => ratio(r.operating_income, r.revenue),
  },
  {
    id: 'inventory_turnover',
    label: '재고회전율',
    unit: 'times',
    digits: 1,
    compute: (r) => ratio(r.revenue, r.inventory),
  },
  {
    id: 'cogs_ratio',
    label: '매출원가율',
    unit: 'percent',
    compute: (r) => ratio(r.cogs, r.revenue),
  },
  {
    id: 'sga_ratio',
    label: '판관비율',
    unit: 'percent',
    compute: (r) => ratio(r.sga, r.revenue),
  },
  {
    id: 'debt_ratio',
    label: '부채비율',
    unit: 'percent',
    digits: 0,
    compute: (r) => ratio(r.total_liabilities, r.total_equity),
  },
  {
    id: 'labor_ratio',
    label: '인건비율',
    unit: 'percent',
    compute: (r) => ratio(r.labor_cost, r.revenue),
  },
  {
    id: 'roe',
    label: 'ROE',
    unit: 'percent',
    compute: (r) => ratio(r.net_income, r.total_equity),
  },
  {
    id: 'equity_ratio',
    label: '자기자본비율',
    unit: 'percent',
    compute: (r) => ratio(r.total_equity, r.total_assets),
  },
];

/** 한국식 압축 표기: M(백만) 단위 값 → "1.2조" / "350억" / "8.5억" / "120M" */
export function formatKoreanCompact(millionValue: number): string {
  const abs = Math.abs(millionValue);
  if (abs >= 1_000_000) return `${(millionValue / 1_000_000).toFixed(1)}조`;
  if (abs >= 100) return `${(millionValue / 100).toFixed(0)}억`;
  return `${millionValue.toFixed(0)}M`;
}

function defaultDigits(unit: MetricUnit): number {
  switch (unit) {
    case 'percent':
      return 1;
    case 'times':
      return 2;
    case 'million':
      return 0;
  }
}

/** 지표값 표시용 (툴팁/범례). digits 미지정 시 unit 기본값. */
export function formatMetricValue(
  v: number | null | undefined,
  unit: MetricUnit,
  digits?: number
): string {
  if (v == null || Number.isNaN(v)) return '—';
  const d = digits ?? defaultDigits(unit);
  switch (unit) {
    case 'percent':
      return `${(v * 100).toFixed(d)}%`;
    case 'times':
      return `${v.toFixed(d)}회`;
    case 'million':
      return formatKoreanCompact(v);
  }
}

/** Y축 tick 포맷 (간결) — digits 옵션 동일 처리. */
export function formatMetricTick(
  v: number | null | undefined,
  unit: MetricUnit,
  digits?: number
): string {
  if (v == null || Number.isNaN(v)) return '';
  const d = digits ?? defaultDigits(unit);
  switch (unit) {
    case 'percent':
      return `${(v * 100).toFixed(d)}%`;
    case 'times':
      return v.toFixed(d);
    case 'million':
      return formatKoreanCompact(v);
  }
}
