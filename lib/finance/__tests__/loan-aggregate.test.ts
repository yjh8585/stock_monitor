import { describe, it, expect } from 'vitest';
import { buildLoanAchievement, buildLoanKpis } from '../loan-aggregate';
import type { LoanRow } from '../types';

function row(partial: Partial<LoanRow>): LoanRow {
  return {
    period_year: 2026,
    period_month: 1,
    kind: '실적',
    loan_eok: 0,
    ...partial,
  };
}

/**
 * 실적: 2025.01(10), 2025.02(20), 2026.01(5), 2026.02(7)  (2025.03 누락)
 * 계획: 2026.01(8), 2026.02(8), 2026.03(8)
 */
function dataset(): LoanRow[] {
  return [
    row({ period_year: 2025, period_month: 1, kind: '실적', loan_eok: 10 }),
    row({ period_year: 2025, period_month: 2, kind: '실적', loan_eok: 20 }),
    row({ period_year: 2026, period_month: 1, kind: '실적', loan_eok: 5 }),
    row({ period_year: 2026, period_month: 2, kind: '실적', loan_eok: 7 }),
    row({ period_year: 2026, period_month: 1, kind: '계획', loan_eok: 8 }),
    row({ period_year: 2026, period_month: 2, kind: '계획', loan_eok: 8 }),
    row({ period_year: 2026, period_month: 3, kind: '계획', loan_eok: 8 }),
  ];
}

describe('buildLoanAchievement', () => {
  it('월별 오름차순 정렬 + 2025는 계획 없어 plan=null', () => {
    const pts = buildLoanAchievement(dataset());
    expect(pts.map((p) => p.monthLabel)).toEqual([
      '2025.01',
      '2025.02',
      '2026.01',
      '2026.02',
      '2026.03',
    ]);
    expect(pts[0]).toMatchObject({ plan: null, actual: 10, rate: null });
    expect(pts[1]).toMatchObject({ plan: null, actual: 20 });
  });

  it('2026은 계획+실적, rate = actual/plan×100', () => {
    const pts = buildLoanAchievement(dataset());
    const m1 = pts.find((p) => p.monthLabel === '2026.01')!;
    expect(m1).toMatchObject({ plan: 8, actual: 5, rate: 62.5 });
    // 계획만 있고 실적 없는 미래월 → actual=null, rate=null
    const m3 = pts.find((p) => p.monthLabel === '2026.03')!;
    expect(m3).toMatchObject({ plan: 8, actual: null, rate: null });
  });

  it('loan_eok null(공란)은 합산에서 제외 — 해당 종류 값 없으면 null 유지', () => {
    const pts = buildLoanAchievement([
      row({ period_year: 2026, period_month: 5, kind: '실적', loan_eok: null }),
      row({ period_year: 2026, period_month: 5, kind: '계획', loan_eok: 9 }),
    ]);
    expect(pts[0]).toMatchObject({ plan: 9, actual: null, rate: null });
  });
});

describe('buildLoanKpis', () => {
  it('당월=최신 실적월 값, 누적=전체 실적 합', () => {
    const k = buildLoanKpis(dataset());
    expect(k.latestLabel).toBe('2026.02');
    expect(k.currentMonthEok).toBe(7);
    expect(k.cumulativeEok).toBe(42); // 10+20+5+7
  });

  it('지급율 = 2026 YTD 실적 / 동기간 계획 × 100 (동기간만, 3월 계획 제외)', () => {
    const k = buildLoanKpis(dataset());
    // 2026 실적 최신월=2 → 동기간 계획 = 1,2월(8+8=16). 실적=5+7=12 → 75%
    expect(k.ytdActualEok).toBe(12);
    expect(k.ytdPlanEok).toBe(16);
    expect(k.paymentRatePct).toBe(75);
  });

  it('실적 없으면 빈 KPI', () => {
    const k = buildLoanKpis([row({ kind: '계획', loan_eok: 8 })]);
    expect(k).toMatchObject({ latestLabel: '—', currentMonthEok: null, cumulativeEok: null });
  });
});
