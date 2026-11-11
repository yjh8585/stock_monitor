import { describe, expect, it } from 'vitest';
import { aggregateMonthlySeries } from '@/lib/oem-companies/kg-mobility/aggregate';
import { groupMonthToSaleRows, monthlyToQuarterly } from './volume';

describe('monthlyToQuarterly — 물량 차트 분기 보기(A9)', () => {
  const m = (period: string, sales: number) => ({
    period,
    period_label: period,
    sales,
    yoy_pct: null,
  });
  const months = [
    ...['01', '02', '03', '04', '05', '06'].map((mm) => m(`2025-${mm}`, 100)),
    ...['01', '02', '03'].map((mm) => m(`2026-${mm}`, 120)),
    m('2026-04', 500), // 석 달이 안 찬 분기 — 빠져야 한다
  ];
  const qs = monthlyToQuarterly(months);
  it('석 달이 다 있는 분기만 · 합계 · period 는 YYYY-Qn', () => {
    expect(qs.map((q) => [q.period, q.sales])).toEqual([
      ['2025-Q1', 300],
      ['2025-Q2', 300],
      ['2026-Q1', 360],
    ]);
  });
  it('YoY = 전년 같은 분기 대비', () => {
    expect(qs[2].yoy_pct).toBeCloseTo(20);
    expect(qs[0].yoy_pct).toBeNull();
  });
});

describe('groupMonthToSaleRows', () => {
  const rows = [
    { oem_group: '다라그룹', year_month: 202501, sales: 100 },
    { oem_group: '다라그룹', year_month: 202601, sales: 120 },
    { oem_group: '마바그룹', year_month: 202601, sales: 999 },
  ];

  it('지정 그룹만 · YYYYMM → YYYY-MM · 월 행', () => {
    const out = groupMonthToSaleRows(rows, '다라그룹');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      period_type: 'month',
      year_period: '2025-01',
      sales_units: 100,
      resolved_powertrain: null,
    });
  });

  it('기존 KG 월 집계 함수에 그대로 들어간다(YoY)', () => {
    const series = aggregateMonthlySeries(groupMonthToSaleRows(rows, '다라그룹'));
    const jan26 = series.find((p) => p.period === '2026-01');
    expect(jan26?.sales).toBe(120);
    expect(jan26?.yoy_pct).toBeCloseTo(20);
  });
});
