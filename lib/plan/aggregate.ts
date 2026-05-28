/** 손익 계획 차트 시리즈 빌더 (순수 함수). */
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
