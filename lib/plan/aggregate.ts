/** 손익 계획 차트 시리즈 빌더 (순수 함수). */
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { AchievementPoint, PlanRow } from './types';

/** 단위 환산. 지원: 억원↔백만원(1억원=100백만원). USD/동일단위는 그대로. */
export function normalizeUnit(value: number | null, from: string, to: string): number | null {
  if (value === null) return null;
  if (from === to) return value;
  if (from === '백만원' && to === '억원') return value / 100;
  if (from === '억원' && to === '백만원') return value * 100;
  // 그 외(USD 등)는 환산표 없음 — 호출자가 동일 단위만 전달한다고 가정.
  return value;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

interface BuildOpts {
  /** 차트 표시 단위. 모든 plan/actual을 이 단위로 환산. */
  unit: string;
}

/**
 * PlanRow[] → 연도별 (계획·실적·달성율) 포인트.
 *
 * 규칙:
 * - 계획(plan)은 annual 값만 사용 (월별 계획 없음).
 * - 실적(actual): annual이 있으면 그 값. annual 없고 month가 있으면 1~12 합산(YTD) + ytd=true.
 * - 단위는 opts.unit으로 환산.
 * - rate = actual/plan*100. plan null/0이면 null.
 * - 연도 오름차순.
 */
export function buildAchievement(rows: readonly PlanRow[], opts: BuildOpts): AchievementPoint[] {
  const years = new Set<number>();
  for (const r of rows) years.add(r.period_year);

  const points: AchievementPoint[] = [];
  for (const year of Array.from(years).sort((a, b) => a - b)) {
    // 계획 — annual
    const planRow = rows.find(
      (r) => r.period_year === year && r.kind === 'plan' && r.period_type === 'annual'
    );
    const plan =
      planRow && planRow.value !== null
        ? normalizeUnit(planRow.value, planRow.unit, opts.unit)
        : null;

    // 실적 — annual 우선, 없으면 month 합산
    const actualAnnual = rows.find(
      (r) => r.period_year === year && r.kind === 'actual' && r.period_type === 'annual'
    );
    let actual: number | null = null;
    let ytd = false;
    if (actualAnnual && actualAnnual.value !== null) {
      actual = normalizeUnit(actualAnnual.value, actualAnnual.unit, opts.unit);
    } else {
      const months = rows.filter(
        (r) => r.period_year === year && r.kind === 'actual' && r.period_type === 'month'
      );
      if (months.length > 0) {
        ytd = true;
        let sum = 0;
        let hasVal = false;
        for (const m of months) {
          if (m.value !== null) {
            sum += normalizeUnit(m.value, m.unit, opts.unit) ?? 0;
            hasVal = true;
          }
        }
        actual = hasVal ? round(sum) : null;
      }
    }

    const rate = plan && plan !== 0 && actual !== null ? round((actual / plan) * 100) : null;
    points.push({
      yearLabel: ytd ? `${year} YTD` : String(year),
      year,
      ytd,
      plan: plan === null ? null : round(plan),
      actual,
      rate,
    });
  }
  // plan/actual 모두 없는 연도 제거
  return points.filter((p) => p.plan !== null || p.actual !== null);
}

/**
 * 수주 취소제외 series fill — cancel에 없는 연도는 base(수주액) actual로 채운다.
 * 계획은 base(수주액 계획)를 그대로 쓰므로 plan/rate를 base 기준으로 재계산.
 */
export function fillCancelExcluded(
  base: readonly AchievementPoint[],
  cancel: readonly AchievementPoint[]
): AchievementPoint[] {
  const cancelByYear = new Map(cancel.map((p) => [p.year, p]));
  return base.map((b) => {
    const c = cancelByYear.get(b.year);
    const actual = c && c.actual !== null ? c.actual : b.actual;
    const rate = b.plan && b.plan !== 0 && actual !== null ? round((actual / b.plan) * 100) : null;
    return { ...b, actual, rate };
  });
}

// ─────────────────────────────────────────────────────────────────────
// 전사 손익 (매출/영업이익) — pnl_entries actual 우선 + pnl_plan fallback
// ─────────────────────────────────────────────────────────────────────

/** (category,item,basis) 필터 헬퍼 — RevenueTargetChart._selectors.pick과 동등. 순환 의존 회피. */
function pickRows(
  rows: readonly PlanRow[],
  category: string,
  item: string,
  basis: Basis
): PlanRow[] {
  return rows.filter((r) => r.category === category && r.item === item && r.basis === basis);
}

/**
 * 전사 손익 매출/영업이익 차트 공통 빌더.
 *
 * - 계획(plan)은 pnl_plan(category='손익').
 * - 실적(actual)은 pnl_entries(dimensional) 우선. 해당 연도가 pnl_entries에 없으면
 *   pnl_plan의 actual 행(수동 입력된 과거 실적, 예: 2021/2022)으로 fallback.
 */
export function buildCorpAchievement(
  rows: readonly PlanRow[],
  prepared: PreparedPnlData,
  basis: Basis,
  item: '매출' | '영업이익',
  metric: 'revenue' | 'op_income'
): AchievementPoint[] {
  const planRows = pickRows(rows, '손익', item, basis);
  const planPts = buildAchievement(planRows, { unit: '억원' });
  // pnl_entries 연간(+2026 YTD) 전사 합계 → 백만원이므로 ÷100 = 억원
  const annual = prepared.annualByBasis[basis];
  const labels = getDisplayYearLabels(annual, basis);
  const entriesActualByYear = new Map<number, { value: number; ytd: boolean }>();
  for (const lbl of labels) {
    const yr = parseInt(lbl.slice(0, 4), 10);
    const agg = aggregateBy(entriesForYear(annual, basis, lbl), []);
    if (agg.length > 0) {
      entriesActualByYear.set(yr, { value: agg[0][metric] / 100, ytd: lbl === '2026' });
    }
  }
  const years = new Set<number>([...planPts.map((p) => p.year), ...entriesActualByYear.keys()]);
  const out: AchievementPoint[] = [];
  for (const year of Array.from(years).sort((a, b) => a - b)) {
    const pp = planPts.find((p) => p.year === year);
    const plan = pp?.plan ?? null;
    let actual: number | null = null;
    let ytd = false;
    const e = entriesActualByYear.get(year);
    if (e) {
      actual = round(e.value);
      ytd = e.ytd;
    } else if (pp?.actual !== null && pp?.actual !== undefined) {
      actual = pp.actual;
    }
    const rate = plan && plan !== 0 && actual !== null ? round((actual / plan) * 100) : null;
    if (plan === null && actual === null) continue;
    out.push({ yearLabel: ytd ? `${year} YTD` : String(year), year, ytd, plan, actual, rate });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 정확도 / 효율 분석 (차트 10·11·12·13)
// ─────────────────────────────────────────────────────────────────────

/** 정확도 분석에서 사용하는 KPI 정의. */
export interface KpiDef {
  key: string;
  label: string;
  color: string;
  /** 'plan' = pnl_plan 단독, 'corp' = pnl_entries 우선 + pnl_plan fallback */
  source: 'plan' | 'corp';
  category: string;
  item: string;
  basis: Basis;
  /** source='corp'일 때만 사용 */
  metric?: 'revenue' | 'op_income';
  /** 표시 단위 (rate만 계산할 때는 의미 없음 — 단지 buildAchievement용 placeholder) */
  unit: string;
}

/** 차트 10 multi-line의 기본 KPI 6개. */
export const DEFAULT_ACCURACY_KPIS: readonly KpiDef[] = [
  {
    key: 'order',
    label: '수주액',
    color: '#2563eb',
    source: 'plan',
    category: '수주',
    item: '수주액',
    basis: 'consolidated',
    unit: '억원',
  },
  {
    key: 'rev_corp',
    label: '전사 매출(연결)',
    color: '#16a34a',
    source: 'corp',
    category: '손익',
    item: '매출',
    basis: 'consolidated',
    metric: 'revenue',
    unit: '억원',
  },
  {
    key: 'op_corp',
    label: '전사 영업이익(연결)',
    color: '#dc2626',
    source: 'corp',
    category: '손익',
    item: '영업이익',
    basis: 'consolidated',
    metric: 'op_income',
    unit: '억원',
  },
  {
    key: 'rev_us',
    label: '미국 매출',
    color: '#9333ea',
    source: 'plan',
    category: '미국',
    item: '매출',
    basis: 'consolidated',
    unit: '억원',
  },
  {
    key: 'rev_ss',
    label: '상숙 매출',
    color: '#ea580c',
    source: 'plan',
    category: '상숙',
    item: '매출',
    basis: 'consolidated',
    unit: '억원',
  },
  {
    key: 'rev_jl',
    label: '지린 매출',
    color: '#0891b2',
    source: 'plan',
    category: '지린',
    item: '매출',
    basis: 'consolidated',
    unit: '억원',
  },
];

/** 차트 11(표) 확장 KPI — 디폴트 6개 + 법인 영업이익 3개. */
export const EXTENDED_ACCURACY_KPIS: readonly KpiDef[] = [
  ...DEFAULT_ACCURACY_KPIS,
  {
    key: 'op_us',
    label: '미국 영업이익',
    color: '#a855f7',
    source: 'plan',
    category: '미국',
    item: '영업이익',
    basis: 'consolidated',
    unit: '억원',
  },
  {
    key: 'op_ss',
    label: '상숙 영업이익',
    color: '#f97316',
    source: 'plan',
    category: '상숙',
    item: '영업이익',
    basis: 'consolidated',
    unit: '억원',
  },
  {
    key: 'op_jl',
    label: '지린 영업이익',
    color: '#06b6d4',
    source: 'plan',
    category: '지린',
    item: '영업이익',
    basis: 'consolidated',
    unit: '억원',
  },
];

function pointsForKpi(
  rows: readonly PlanRow[],
  prepared: PreparedPnlData,
  k: KpiDef
): AchievementPoint[] {
  if (k.source === 'corp') {
    return buildCorpAchievement(
      rows,
      prepared,
      k.basis,
      k.item as '매출' | '영업이익',
      k.metric ?? 'revenue'
    );
  }
  return buildAchievement(pickRows(rows, k.category, k.item, k.basis), { unit: k.unit });
}

/** 차트 10용: 연도별 KPI 달성률(%) flat dict. */
export interface AccuracySeriesPoint {
  year: number;
  yearLabel: string;
  /** KPI key → 달성률(%) (없으면 null) */
  [kpiKey: string]: number | string | null;
}

/**
 * 다년 달성률 추이 — 각 KPI별 연도 달성률을 행 단위로 펼친다.
 * recharts ComposedChart의 data로 바로 사용 가능 (key=KPI key).
 */
export function buildAccuracySeries(
  rows: readonly PlanRow[],
  prepared: PreparedPnlData,
  kpis: readonly KpiDef[]
): AccuracySeriesPoint[] {
  const kpiPts = kpis.map((k) => ({ k, pts: pointsForKpi(rows, prepared, k) }));
  const years = new Set<number>();
  for (const { pts } of kpiPts) for (const p of pts) years.add(p.year);
  return Array.from(years)
    .sort((a, b) => a - b)
    .map((year) => {
      const row: AccuracySeriesPoint = { year, yearLabel: String(year) };
      for (const { k, pts } of kpiPts) {
        const p = pts.find((x) => x.year === year);
        row[k.key] = p?.rate ?? null;
      }
      return row;
    });
}

/** 차트 11용: KPI별 통계 한 행. */
export interface AccuracyStat {
  key: string;
  label: string;
  /** 평균 달성률(%). 데이터 0개면 null. */
  avg: number | null;
  /** 표준편차(%). 데이터 1개면 0. */
  std: number | null;
  max: number | null;
  min: number | null;
  /** 산정에 사용된 연도 수 (plan·actual 모두 있는 연도). */
  count: number;
}

/** 통계는 std 내림차순 정렬 — 들쭉날쭉한 KPI 위로. */
export function buildAccuracyStats(
  rows: readonly PlanRow[],
  prepared: PreparedPnlData,
  kpis: readonly KpiDef[]
): AccuracyStat[] {
  const stats = kpis.map<AccuracyStat>((k) => {
    const pts = pointsForKpi(rows, prepared, k);
    const rates = pts.map((p) => p.rate).filter((r): r is number => r !== null);
    if (rates.length === 0) {
      return { key: k.key, label: k.label, avg: null, std: null, max: null, min: null, count: 0 };
    }
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((a, b) => a + (b - avg) ** 2, 0) / rates.length;
    return {
      key: k.key,
      label: k.label,
      avg: Math.round(avg * 10) / 10,
      std: Math.round(Math.sqrt(variance) * 10) / 10,
      max: Math.round(Math.max(...rates) * 10) / 10,
      min: Math.round(Math.min(...rates) * 10) / 10,
      count: rates.length,
    };
  });
  stats.sort((a, b) => (b.std ?? -1) - (a.std ?? -1));
  return stats;
}

/** 차트 12용: t년 수주 → (t+1)년 매출 변환. */
export interface ConversionPoint {
  /** t년 (수주 연도) */
  year: number;
  yearLabel: string;
  /** t년 수주액 actual (억원) */
  orderAmount: number | null;
  /** (t+1)년 매출 actual (억원) */
  nextRevenue: number | null;
  /** (t+1 매출 / t 수주) × 100 */
  conversionRate: number | null;
}

/**
 * 수주 → 매출 conversion.
 * - t년 수주액 actual은 pnl_plan (consolidated).
 * - (t+1)년 매출 actual은 pnl_entries 우선, 없으면 pnl_plan의 손익.매출 actual fallback.
 */
export function buildOrderToRevenue(
  rows: readonly PlanRow[],
  prepared: PreparedPnlData
): ConversionPoint[] {
  const orderRows = rows.filter(
    (r) =>
      r.category === '수주' &&
      r.item === '수주액' &&
      r.kind === 'actual' &&
      r.period_type === 'annual' &&
      r.basis === 'consolidated'
  );
  const orderByYear = new Map<number, number>();
  for (const r of orderRows) {
    if (r.value !== null) {
      const inEokwon = normalizeUnit(r.value, r.unit, '억원');
      if (inEokwon !== null) orderByYear.set(r.period_year, inEokwon);
    }
  }
  // 매출 actual (consolidated, annual): pnl_entries 우선
  const annual = prepared.annualByBasis.consolidated;
  const labels = getDisplayYearLabels(annual, 'consolidated');
  const revenueByYear = new Map<number, number>();
  for (const lbl of labels) {
    const yr = parseInt(lbl.slice(0, 4), 10);
    const agg = aggregateBy(entriesForYear(annual, 'consolidated', lbl), []);
    if (agg.length > 0) revenueByYear.set(yr, agg[0].revenue / 100);
  }
  // pnl_plan 손익.매출 actual fallback (2021/2022)
  const planRev = rows.filter(
    (r) =>
      r.category === '손익' &&
      r.item === '매출' &&
      r.kind === 'actual' &&
      r.period_type === 'annual' &&
      r.basis === 'consolidated'
  );
  for (const r of planRev) {
    if (r.value !== null && !revenueByYear.has(r.period_year)) {
      const inEokwon = normalizeUnit(r.value, r.unit, '억원');
      if (inEokwon !== null) revenueByYear.set(r.period_year, inEokwon);
    }
  }
  const out: ConversionPoint[] = [];
  for (const t of Array.from(orderByYear.keys()).sort((a, b) => a - b)) {
    const orderAmount = orderByYear.get(t) ?? null;
    const nextRevenue = revenueByYear.get(t + 1) ?? null;
    const conversionRate =
      orderAmount && orderAmount !== 0 && nextRevenue !== null
        ? Math.round((nextRevenue / orderAmount) * 1000) / 10
        : null;
    out.push({
      year: t,
      yearLabel: `${t} → ${t + 1}`,
      orderAmount: orderAmount === null ? null : round(orderAmount),
      nextRevenue: nextRevenue === null ? null : round(nextRevenue),
      conversionRate,
    });
  }
  return out;
}

/** 차트 13용: 손익개선 종합. */
export interface ImprovementPoint {
  year: number;
  yearLabel: string;
  designVe: number | null;
  mcip: number | null;
  priceUp: number | null;
  /** 3개 합 (백만원) */
  total: number | null;
  /** 영업이익 actual (백만원) */
  opIncome: number | null;
  /** total / opIncome × 100 */
  contribRate: number | null;
}

/**
 * 손익개선 3항목(Design VE/MCIP/단가인상) actual 합산 + 영업이익 대비 기여율.
 * 단위는 pnl_plan에 입력된 그대로(통상 백만원).
 * 영업이익은 pnl_entries 우선, 없으면 pnl_plan.손익.영업이익 actual fallback.
 */
export function buildImprovementContribution(
  rows: readonly PlanRow[],
  prepared: PreparedPnlData
): ImprovementPoint[] {
  const pickActual = (item: string) =>
    rows.filter(
      (r) =>
        r.category === '손익개선' &&
        r.item === item &&
        r.kind === 'actual' &&
        r.period_type === 'annual' &&
        r.basis === 'consolidated'
    );
  const ve = new Map<number, number>();
  const mc = new Map<number, number>();
  const pr = new Map<number, number>();
  for (const r of pickActual('Design VE')) if (r.value !== null) ve.set(r.period_year, r.value);
  for (const r of pickActual('MCIP')) if (r.value !== null) mc.set(r.period_year, r.value);
  for (const r of pickActual('단가인상')) if (r.value !== null) pr.set(r.period_year, r.value);

  // 영업이익 — pnl_entries 우선 (백만원 단위 그대로)
  const annual = prepared.annualByBasis.consolidated;
  const labels = getDisplayYearLabels(annual, 'consolidated');
  const opByYear = new Map<number, number>();
  for (const lbl of labels) {
    const yr = parseInt(lbl.slice(0, 4), 10);
    const agg = aggregateBy(entriesForYear(annual, 'consolidated', lbl), []);
    if (agg.length > 0) opByYear.set(yr, agg[0].op_income);
  }
  // pnl_plan 손익.영업이익 fallback (억원 → 백만원)
  const planOp = rows.filter(
    (r) =>
      r.category === '손익' &&
      r.item === '영업이익' &&
      r.kind === 'actual' &&
      r.period_type === 'annual' &&
      r.basis === 'consolidated'
  );
  for (const r of planOp) {
    if (r.value !== null && !opByYear.has(r.period_year)) {
      const inMil = normalizeUnit(r.value, r.unit, '백만원');
      if (inMil !== null) opByYear.set(r.period_year, inMil);
    }
  }

  const years = new Set<number>([...ve.keys(), ...mc.keys(), ...pr.keys()]);
  const out: ImprovementPoint[] = [];
  for (const year of Array.from(years).sort((a, b) => a - b)) {
    const veV = ve.get(year) ?? null;
    const mcV = mc.get(year) ?? null;
    const prV = pr.get(year) ?? null;
    const vals = [veV, mcV, prV].filter((v): v is number => v !== null);
    const total = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
    const op = opByYear.get(year) ?? null;
    const contribRate =
      total !== null && op !== null && op !== 0 ? Math.round((total / op) * 1000) / 10 : null;
    out.push({
      year,
      yearLabel: String(year),
      designVe: veV,
      mcip: mcV,
      priceUp: prV,
      total,
      opIncome: op,
      contribRate,
    });
  }
  return out;
}
