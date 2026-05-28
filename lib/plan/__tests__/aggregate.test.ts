import { describe, it, expect } from 'vitest';
import {
  buildAccuracySeries,
  buildAccuracyStats,
  buildAchievement,
  fillCancelExcluded,
  normalizeUnit,
  type KpiDef,
} from '../aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { PlanRow } from '../types';

function row(p: Partial<PlanRow>): PlanRow {
  return {
    category: '수주',
    item: '수주액',
    basis: 'consolidated',
    kind: 'plan',
    period_year: 2025,
    period_type: 'annual',
    period_month: 0,
    unit: '억원',
    value: 0,
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
      row({
        kind: 'actual',
        period_year: 2026,
        period_type: 'month',
        period_month: 1,
        unit: '백만원',
        value: 200,
      }),
    ];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts[0].actual).toBe(2); // 200백만원 = 2억원
    expect(pts[0].rate).toBe(40);
  });
});

// 정확도 차트 테스트 — source='plan'만 사용 (prepared 의존 ✖).
const emptyPrepared: PreparedPnlData = {
  annualEntries: [],
  annualByBasis: { consolidated: [], standalone: [] },
  monthlyByBasis: { consolidated: [], standalone: [] },
};

const kpiOrder: KpiDef = {
  key: 'order',
  label: '수주액',
  color: '#2563eb',
  source: 'plan',
  category: '수주',
  item: '수주액',
  basis: 'consolidated',
  unit: '억원',
};

describe('buildAccuracySeries', () => {
  it('단일 KPI의 다년 달성률을 펼친다', () => {
    const rows: PlanRow[] = [
      row({ category: '수주', item: '수주액', kind: 'plan', period_year: 2023, value: 100 }),
      row({ category: '수주', item: '수주액', kind: 'actual', period_year: 2023, value: 80 }),
      row({ category: '수주', item: '수주액', kind: 'plan', period_year: 2024, value: 100 }),
      row({ category: '수주', item: '수주액', kind: 'actual', period_year: 2024, value: 110 }),
    ];
    const pts = buildAccuracySeries(rows, emptyPrepared, [kpiOrder]);
    expect(pts).toEqual([
      { year: 2023, yearLabel: '2023', order: 80 },
      { year: 2024, yearLabel: '2024', order: 110 },
    ]);
  });

  it('KPI 데이터 없는 연도는 null', () => {
    const rows: PlanRow[] = [
      row({ category: '수주', item: '수주액', kind: 'plan', period_year: 2023, value: 100 }),
      row({ category: '수주', item: '수주액', kind: 'actual', period_year: 2023, value: 80 }),
      // 2024는 actual 없음 → rate null
      row({ category: '수주', item: '수주액', kind: 'plan', period_year: 2024, value: 100 }),
    ];
    const pts = buildAccuracySeries(rows, emptyPrepared, [kpiOrder]);
    expect(pts).toEqual([
      { year: 2023, yearLabel: '2023', order: 80 },
      { year: 2024, yearLabel: '2024', order: null },
    ]);
  });
});

describe('buildAccuracyStats', () => {
  it('평균·표준편차·최고·최저·연도수 계산', () => {
    const rows: PlanRow[] = [
      row({ category: '수주', item: '수주액', kind: 'plan', period_year: 2021, value: 100 }),
      row({ category: '수주', item: '수주액', kind: 'actual', period_year: 2021, value: 80 }),
      row({ category: '수주', item: '수주액', kind: 'plan', period_year: 2022, value: 100 }),
      row({ category: '수주', item: '수주액', kind: 'actual', period_year: 2022, value: 100 }),
      row({ category: '수주', item: '수주액', kind: 'plan', period_year: 2023, value: 100 }),
      row({ category: '수주', item: '수주액', kind: 'actual', period_year: 2023, value: 120 }),
    ];
    const stats = buildAccuracyStats(rows, emptyPrepared, [kpiOrder]);
    // rates = [80, 100, 120], avg=100, variance = (400+0+400)/3 = 266.67, std ≈ 16.3
    expect(stats[0].label).toBe('수주액');
    expect(stats[0].avg).toBe(100);
    expect(stats[0].std).toBeCloseTo(16.3, 1);
    expect(stats[0].max).toBe(120);
    expect(stats[0].min).toBe(80);
    expect(stats[0].count).toBe(3);
  });

  it('데이터 0개면 count=0 + 통계 null', () => {
    const stats = buildAccuracyStats([], emptyPrepared, [kpiOrder]);
    expect(stats[0]).toEqual({
      key: 'order',
      label: '수주액',
      avg: null,
      std: null,
      max: null,
      min: null,
      count: 0,
    });
  });

  it('표준편차 내림차순 정렬', () => {
    const kpiA: KpiDef = { ...kpiOrder, key: 'a', label: 'A' };
    const kpiB: KpiDef = { ...kpiOrder, key: 'b', label: 'B', item: '수주성공' };
    // A는 변동 적음, B는 변동 큼 — B가 먼저 와야.
    const rows: PlanRow[] = [
      // A
      row({ item: '수주액', kind: 'plan', period_year: 2023, value: 100 }),
      row({ item: '수주액', kind: 'actual', period_year: 2023, value: 99 }),
      row({ item: '수주액', kind: 'plan', period_year: 2024, value: 100 }),
      row({ item: '수주액', kind: 'actual', period_year: 2024, value: 101 }),
      // B
      row({ item: '수주성공', kind: 'plan', period_year: 2023, value: 100 }),
      row({ item: '수주성공', kind: 'actual', period_year: 2023, value: 50 }),
      row({ item: '수주성공', kind: 'plan', period_year: 2024, value: 100 }),
      row({ item: '수주성공', kind: 'actual', period_year: 2024, value: 150 }),
    ];
    const stats = buildAccuracyStats(rows, emptyPrepared, [kpiA, kpiB]);
    expect(stats[0].key).toBe('b');
    expect(stats[1].key).toBe('a');
  });
});

describe('fillCancelExcluded', () => {
  it('취소제외 결측 연도는 수주액 실적으로 채운다', () => {
    const base = [
      { yearLabel: '2024', year: 2024, ytd: false, plan: 100, actual: 90, rate: 90 },
      {
        yearLabel: '2025',
        year: 2025,
        ytd: false,
        plan: 110,
        actual: 100,
        rate: (100 / 110) * 100,
      },
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
