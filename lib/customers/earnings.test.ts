import { describe, expect, it } from 'vitest';
import { buildEarnings } from './earnings';
import type { FinancialPeriodRow } from './types';

const q = (
  y: number,
  qt: number,
  revenue: number | null,
  extra: Partial<FinancialPeriodRow> = {}
): FinancialPeriodRow => ({
  fiscal_year: y,
  fiscal_quarter: qt,
  period_type: 'quarterly',
  period_end_date: `${y}-${String(qt * 3).padStart(2, '0')}-28`,
  currency: 'USD',
  revenue,
  operating_income: revenue == null ? null : revenue / 10,
  operating_margin: revenue == null ? null : 10,
  net_income: null,
  ...extra,
});
const a = (
  y: number,
  revenue: number,
  extra: Partial<FinancialPeriodRow> = {}
): FinancialPeriodRow => ({
  fiscal_year: y,
  fiscal_quarter: null,
  period_type: 'annual',
  period_end_date: `${y}-12-31`,
  currency: 'USD',
  revenue,
  operating_income: revenue / 20,
  operating_margin: 5,
  net_income: -1,
  ...extra,
});

describe('buildEarnings', () => {
  it('백만 → 십억, 분기 라벨·오름차순', () => {
    const r = buildEarnings([q(2026, 2, 2000), q(2026, 1, 1000)]);
    expect(r.currency).toBe('USD');
    expect(r.quarterly.map((p) => p.period_label)).toEqual(['2026Q1', '2026Q2']);
    expect(r.quarterly[1].revenue_bn).toBe(2);
    expect(r.quarterly[1].operating_income_bn).toBe(0.2);
  });

  it('전년 같은 분기 대비 매출 YoY', () => {
    const r = buildEarnings([q(2025, 1, 1000), q(2026, 1, 1100)]);
    expect(r.quarterly[1].revenue_yoy_pct).toBeCloseTo(10);
    expect(r.quarterly[0].revenue_yoy_pct).toBeNull();
  });

  it('최신 매출 행의 통화만 남긴다(통화 혼재)', () => {
    const r = buildEarnings([
      q(2024, 3, 5, { currency: 'USD' }),
      q(2026, 2, 900000, { currency: 'VND' }),
      a(2025, 3000000, { currency: 'VND' }),
    ]);
    expect(r.currency).toBe('VND');
    expect(r.quarterly.map((p) => p.period_label)).toEqual(['2026Q2']);
  });

  it('같은 기간 중복은 결산일이 늦은 행', () => {
    const r = buildEarnings([
      q(2026, 1, 100, { period_end_date: '2026-03-28' }),
      q(2026, 1, 200, { period_end_date: '2026-03-31' }),
    ]);
    expect(r.quarterly).toHaveLength(1);
    expect(r.quarterly[0].revenue_bn).toBe(0.2);
  });

  it('매출 null 분기는 남기되 값은 null · 연간 분리', () => {
    const r = buildEarnings([q(2026, 1, null), a(2025, 4000)]);
    expect(r.quarterly[0].revenue_bn).toBeNull();
    expect(r.annual[0]).toMatchObject({
      period_label: '2025',
      revenue_bn: 4,
      net_income_bn: -0.001,
    });
  });

  it('행이 없으면 통화 null·빈 배열', () => {
    expect(buildEarnings([])).toEqual({ currency: null, quarterly: [], annual: [] });
  });
});
