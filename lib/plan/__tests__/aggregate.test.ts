import { describe, it, expect } from 'vitest';
import {
  normalizeUnit,
  buildAchievement,
  fillCancelExcluded,
} from '../aggregate';
import type { PlanRow } from '../types';

function row(p: Partial<PlanRow>): PlanRow {
  return {
    category: '수주', item: '수주액', basis: 'consolidated', kind: 'plan',
    period_year: 2025, period_type: 'annual', period_month: 0, unit: '억원', value: 0,
    ...p,
  };
}

describe('normalizeUnit', () => {
  it('백만원 → 억원 (÷100)', () => {
    expect(normalizeUnit(500, '백만원', '억원')).toBe(5);
  });
  it('같은 단위는 그대로', () => {
    expect(normalizeUnit(10, '억원', '억원')).toBe(10);
  });
  it('null은 null', () => {
    expect(normalizeUnit(null, '백만원', '억원')).toBeNull();
  });
});

describe('buildAchievement', () => {
  it('연간 계획+실적 → 달성율', () => {
    const rows: PlanRow[] = [
      row({ kind: 'plan', period_year: 2024, value: 100 }),
      row({ kind: 'actual', period_year: 2024, value: 80 }),
    ];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts).toEqual([
      { yearLabel: '2024', year: 2024, ytd: false, plan: 100, actual: 80, rate: 80 },
    ]);
  });

  it('2026 월별 실적은 YTD 합산, 계획은 연간 그대로, 라벨 YTD', () => {
    const rows: PlanRow[] = [
      row({ kind: 'plan', period_year: 2026, period_type: 'annual', value: 120 }),
      row({ kind: 'actual', period_year: 2026, period_type: 'month', period_month: 1, value: 10 }),
      row({ kind: 'actual', period_year: 2026, period_type: 'month', period_month: 2, value: 20 }),
    ];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts).toEqual([
      { yearLabel: '2026 YTD', year: 2026, ytd: true, plan: 120, actual: 30, rate: 25 },
    ]);
  });

  it('계획 없으면 rate null', () => {
    const rows: PlanRow[] = [row({ kind: 'actual', period_year: 2023, value: 50 })];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts[0].plan).toBeNull();
    expect(pts[0].rate).toBeNull();
  });

  it('백만원 실적을 억원으로 환산', () => {
    const rows: PlanRow[] = [
      row({ kind: 'plan', period_year: 2026, period_type: 'annual', unit: '억원', value: 5 }),
      row({ kind: 'actual', period_year: 2026, period_type: 'month', period_month: 1, unit: '백만원', value: 200 }),
    ];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts[0].actual).toBe(2); // 200백만원 = 2억원
    expect(pts[0].rate).toBe(40);
  });
});

describe('fillCancelExcluded', () => {
  it('취소제외 결측 연도는 수주액 실적으로 채운다', () => {
    const base = [
      { yearLabel: '2024', year: 2024, ytd: false, plan: 100, actual: 90, rate: 90 },
      { yearLabel: '2025', year: 2025, ytd: false, plan: 110, actual: 100, rate: 100 / 110 * 100 },
    ];
    const cancel = [
      { yearLabel: '2024', year: 2024, ytd: false, plan: 100, actual: 85, rate: 85 },
      // 2025 없음
    ];
    const filled = fillCancelExcluded(base, cancel);
    expect(filled.find((p) => p.year === 2024)!.actual).toBe(85);
    expect(filled.find((p) => p.year === 2025)!.actual).toBe(100); // base로 채움
  });
});
