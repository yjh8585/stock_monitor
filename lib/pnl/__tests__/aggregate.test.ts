import { describe, expect, it } from 'vitest';
import { grossProfitOf, ratioOfRevenue } from '@/lib/pnl/aggregate';
import type { AggregatedRow } from '@/lib/pnl/types';

describe('vitest sanity — aggregate.ts', () => {
  it('ratioOfRevenue: 매출이 0이면 null', () => {
    expect(ratioOfRevenue(100, 0)).toBeNull();
  });

  it('ratioOfRevenue: 매출 대비 % 계산', () => {
    expect(ratioOfRevenue(25, 100)).toBe(25);
  });

  it('grossProfitOf: 매출 - 재료 - 노무 - 경비', () => {
    const row: AggregatedRow = {
      key: 'test',
      dims: { sil: '', division: '', factory: '', product: '', customer: '' },
      revenue: 1000,
      material_cost: 300,
      labor_cost: 200,
      expense: 100,
      sga: 50,
      rnd: 20,
      op_income: 330,
    };
    expect(grossProfitOf(row)).toBe(400);
  });
});
