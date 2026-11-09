import { describe, expect, it } from 'vitest';
import { aggregateMonthlySeries } from '@/lib/oem-companies/kg-mobility/aggregate';
import { groupMonthToSaleRows } from './volume';

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
