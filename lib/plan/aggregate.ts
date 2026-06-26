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

/**
 * 영업이익 포인트에 매출 포인트로 영업이익률(%)을 부여 — 연도 매칭.
 * 영업이익률 = 영업이익/매출*100. 매출이 null/0이면 해당 마진 null.
 * 단위 환산(USD↔억원)에 불변이므로 동일 단위 쌍이면 어느 통화에서 호출해도 동일.
 */
export function attachMargin(
  opPoints: readonly AchievementPoint[],
  revPoints: readonly AchievementPoint[]
): AchievementPoint[] {
  const revByYear = new Map(revPoints.map((p) => [p.year, p]));
  return opPoints.map((op) => {
    const rev = revByYear.get(op.year);
    const marginPlan =
      rev && rev.plan && rev.plan !== 0 && op.plan !== null
        ? round((op.plan / rev.plan) * 100)
        : null;
    const marginActual =
      rev && rev.actual && rev.actual !== 0 && op.actual !== null
        ? round((op.actual / rev.actual) * 100)
        : null;
    return { ...op, marginPlan, marginActual };
  });
}

// ─────────────────────────────────────────────────────────────────────
// 전사 손익 (매출/영업이익) — pnl_entries actual 우선 + pnl_plan fallback
// ─────────────────────────────────────────────────────────────────────

/** (category,item,basis) 필터 헬퍼 — 순환 의존 회피를 위해 여기 둔다. */
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
