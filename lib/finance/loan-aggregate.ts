/**
 * 대여금(이인텔리전스) 순수 집계 빌더.
 *
 * - 단위: loan_eok = 억원 (소스가 이미 억원, 환산 없음).
 * - 차트: 재고 계획대비 차트(InventoryAchievementChart)를 재사용하므로
 *   AchievementMonthPoint[]를 반환(plan/actual/rate). 2025는 계획 없어 plan=null.
 * - KPI: 당월(최신 실적월)·누적(전체 실적 합)·2026 YTD 동기간 지급율.
 */
import type { AchievementMonthPoint } from '@/lib/inventory/types';
import type { LoanKpis, LoanRow } from './types';

const YTD_YEAR = 2026;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 부동소수 오차 정리 (소수 1자리). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 월별 계획·실적 막대 포인트 (오름차순). value 공란(null)은 합산에서 제외. */
export function buildLoanAchievement(rows: readonly LoanRow[]): AchievementMonthPoint[] {
  interface Agg {
    year: number;
    month: number;
    plan: number | null;
    actual: number | null;
  }
  const byKey = new Map<string, Agg>();
  for (const r of rows) {
    const key = `${r.period_year}-${r.period_month}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { year: r.period_year, month: r.period_month, plan: null, actual: null };
      byKey.set(key, agg);
    }
    if (r.loan_eok === null) continue;
    if (r.kind === '계획') agg.plan = round1((agg.plan ?? 0) + r.loan_eok);
    else agg.actual = round1((agg.actual ?? 0) + r.loan_eok);
  }
  const pts: AchievementMonthPoint[] = [];
  for (const agg of byKey.values()) {
    const rate =
      agg.plan !== null && agg.plan !== 0 && agg.actual !== null
        ? round1((agg.actual / agg.plan) * 100)
        : null;
    pts.push({
      monthLabel: `${agg.year}.${pad2(agg.month)}`,
      year: agg.year,
      month: agg.month,
      plan: agg.plan,
      actual: agg.actual,
      rate,
    });
  }
  return pts.sort((a, b) => a.year - b.year || a.month - b.month);
}

/** KPI — 당월(최신 실적월) · 누적(전체 실적 합) · 2026 YTD 동기간 지급율. */
export function buildLoanKpis(rows: readonly LoanRow[]): LoanKpis {
  const empty: LoanKpis = {
    latestLabel: '—',
    currentMonthEok: null,
    cumulativeEok: null,
    ytdActualEok: null,
    ytdPlanEok: null,
    paymentRatePct: null,
  };

  const actuals = rows.filter((r) => r.kind === '실적' && r.loan_eok !== null);
  if (actuals.length === 0) return empty;

  // 최신 실적월 → 당월 대여금
  const latest = [...actuals].sort(
    (a, b) => b.period_year - a.period_year || b.period_month - a.period_month
  )[0];
  const latestLabel = `${latest.period_year}.${pad2(latest.period_month)}`;
  const currentMonthEok = latest.loan_eok;

  // 누적 대여금 = 전체(2025~) 실적 합
  const cumulativeEok = round1(actuals.reduce((s, r) => s + (r.loan_eok ?? 0), 0));

  // 2026 YTD 지급율 = 2026 실적 누적 / 2026 동기간 계획 누적 × 100
  let ytdActualEok: number | null = null;
  let ytdPlanEok: number | null = null;
  let paymentRatePct: number | null = null;
  const ytdActuals = actuals.filter((r) => r.period_year === YTD_YEAR);
  if (ytdActuals.length > 0) {
    const maxMonth = Math.max(...ytdActuals.map((r) => r.period_month));
    ytdActualEok = round1(
      ytdActuals
        .filter((r) => r.period_month <= maxMonth)
        .reduce((s, r) => s + (r.loan_eok ?? 0), 0)
    );
    const planYtd = rows.filter(
      (r) =>
        r.kind === '계획' &&
        r.period_year === YTD_YEAR &&
        r.period_month <= maxMonth &&
        r.loan_eok !== null
    );
    if (planYtd.length > 0) {
      ytdPlanEok = round1(planYtd.reduce((s, r) => s + (r.loan_eok ?? 0), 0));
      paymentRatePct = ytdPlanEok !== 0 ? round1((ytdActualEok / ytdPlanEok) * 100) : null;
    }
  }

  return { latestLabel, currentMonthEok, cumulativeEok, ytdActualEok, ytdPlanEok, paymentRatePct };
}
