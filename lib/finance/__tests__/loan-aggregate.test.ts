import { describe, it, expect } from 'vitest';
import { currentYear } from '@/lib/currentYear';
import { buildLoanAchievement, buildLoanKpis } from '../loan-aggregate';
import type { LoanRow } from '../types';

// buildLoanKpis의 YTD 집계가 currentYear() 기준이라 fixture도 당해·전년을 따라가야 한다.
// 🔴 모듈 최상단에서 한 번만 계산하면 import 시점(테스트 실행 전) 값이 굳어, 테스트 안에서
// 시스템 시각을 흉내내도(vi.setSystemTime) 실제 실행 시점의 currentYear()와 어긋난다 —
// 그래서 함수로 두고 매번 다시 부른다.
function Y(): number {
  return currentYear();
}
function YPREV(): number {
  return currentYear() - 1;
}

function row(partial: Partial<LoanRow>): LoanRow {
  return {
    period_year: Y(),
    period_month: 1,
    kind: '실적',
    loan_eok: 0,
    ...partial,
  };
}

/**
 * 실적: (전년).01(10), (전년).02(20), (당해).01(5), (당해).02(7)  (전년.03 누락)
 * 계획: (당해).01(8), (당해).02(8), (당해).03(8)
 */
function dataset(): LoanRow[] {
  return [
    row({ period_year: YPREV(), period_month: 1, kind: '실적', loan_eok: 10 }),
    row({ period_year: YPREV(), period_month: 2, kind: '실적', loan_eok: 20 }),
    row({ period_year: Y(), period_month: 1, kind: '실적', loan_eok: 5 }),
    row({ period_year: Y(), period_month: 2, kind: '실적', loan_eok: 7 }),
    row({ period_year: Y(), period_month: 1, kind: '계획', loan_eok: 8 }),
    row({ period_year: Y(), period_month: 2, kind: '계획', loan_eok: 8 }),
    row({ period_year: Y(), period_month: 3, kind: '계획', loan_eok: 8 }),
  ];
}

describe('buildLoanAchievement', () => {
  it('월별 오름차순 정렬 + 전년은 계획 없어 plan=null', () => {
    const pts = buildLoanAchievement(dataset());
    expect(pts.map((p) => p.monthLabel)).toEqual([
      `${YPREV()}.01`,
      `${YPREV()}.02`,
      `${Y()}.01`,
      `${Y()}.02`,
      `${Y()}.03`,
    ]);
    expect(pts[0]).toMatchObject({ plan: null, actual: 10, rate: null });
    expect(pts[1]).toMatchObject({ plan: null, actual: 20 });
  });

  it('당해는 계획+실적, rate = actual/plan×100', () => {
    const pts = buildLoanAchievement(dataset());
    const m1 = pts.find((p) => p.monthLabel === `${Y()}.01`)!;
    expect(m1).toMatchObject({ plan: 8, actual: 5, rate: 62.5 });
    // 계획만 있고 실적 없는 미래월 → actual=null, rate=null
    const m3 = pts.find((p) => p.monthLabel === `${Y()}.03`)!;
    expect(m3).toMatchObject({ plan: 8, actual: null, rate: null });
  });

  it('loan_eok null(공란)은 합산에서 제외 — 해당 종류 값 없으면 null 유지', () => {
    const pts = buildLoanAchievement([
      row({ period_year: Y(), period_month: 5, kind: '실적', loan_eok: null }),
      row({ period_year: Y(), period_month: 5, kind: '계획', loan_eok: 9 }),
    ]);
    expect(pts[0]).toMatchObject({ plan: 9, actual: null, rate: null });
  });
});

describe('buildLoanKpis', () => {
  it('당월=최신 실적월 값, 누적=전체 실적 합', () => {
    const k = buildLoanKpis(dataset());
    expect(k.latestLabel).toBe(`${Y()}.02`);
    expect(k.currentMonthEok).toBe(7);
    expect(k.cumulativeEok).toBe(42); // 10+20+5+7
  });

  it('지급율 = 당해 YTD 실적 / 동기간 계획 × 100 (동기간만, 3월 계획 제외)', () => {
    const k = buildLoanKpis(dataset());
    // 당해 실적 최신월=2 → 동기간 계획 = 1,2월(8+8=16). 실적=5+7=12 → 75%
    expect(k.ytdActualEok).toBe(12);
    expect(k.ytdPlanEok).toBe(16);
    expect(k.paymentRatePct).toBe(75);
  });

  it('실적 없으면 빈 KPI', () => {
    const k = buildLoanKpis([row({ kind: '계획', loan_eok: 8 })]);
    expect(k).toMatchObject({ latestLabel: '—', currentMonthEok: null, cumulativeEok: null });
  });
});
