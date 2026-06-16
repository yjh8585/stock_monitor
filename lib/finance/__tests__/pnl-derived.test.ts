import { describe, it, expect } from 'vitest';
import { preparePnlData } from '@/lib/pnl/aggregate';
import type { FixedVariableRow, PnlEntry } from '@/lib/pnl/types';
import { buildPnlDerived } from '../pnl-derived';

/** 연결 PnlEntry fixture (op_income만 의미). */
function pnl(p: Partial<PnlEntry>): PnlEntry {
  return {
    basis: 'consolidated',
    year_label: '2024',
    period_year: 2024,
    period_month: 0,
    is_plan: false,
    is_estimate: false,
    sil: '',
    division: '',
    factory: '',
    product: '',
    customer: '',
    revenue: 0,
    material_cost: 0,
    labor_cost: 0,
    expense: 0,
    sga: 0,
    rnd: 0,
    op_income: 0,
    ...p,
  };
}

/** pnl_fixed_variable fixture (기본: 매출원가-경비-감가상각비 고정비). */
function fv(p: Partial<FixedVariableRow>): FixedVariableRow {
  return {
    period_year: 2024,
    period_kind: 'annual',
    period_month: 0,
    cost_type: '고정비',
    category2: '매출원가',
    category3: '경비',
    account: '감가상각비',
    value_mwon: 0,
    ...p,
  };
}

describe('buildPnlDerived', () => {
  const pnlData: PnlEntry[] = [
    pnl({ year_label: '2024', period_year: 2024, period_month: 0, op_income: 8000 }), // 80억
    // 2026 월별 1~4 → opIncome YTD 10억, currentYear=2026, 최신월=4
    pnl({ year_label: '2026', period_year: 2026, period_month: 1, op_income: 250 }),
    pnl({ year_label: '2026', period_year: 2026, period_month: 2, op_income: 250 }),
    pnl({ year_label: '2026', period_year: 2026, period_month: 3, op_income: 250 }),
    pnl({ year_label: '2026', period_year: 2026, period_month: 4, op_income: 250 }),
  ];
  const fixedVariable: FixedVariableRow[] = [
    // 2024 annual 상각비: 감가상각비 1000 + 개발비상각 500 = 1500 → 15억
    fv({ period_year: 2024, period_kind: 'annual', account: '감가상각비', value_mwon: 1000 }),
    fv({ period_year: 2024, period_kind: 'annual', account: '개발비상각', value_mwon: 500 }),
    // 판관-연구개발비-감가상각비도 상각비 합계 대상
    fv({
      period_year: 2024,
      period_kind: 'annual',
      category2: '판매관리비',
      category3: '연구개발비',
      account: '감가상각비',
      value_mwon: 0,
    }),
    // 비-상각비(재료비) — 제외
    fv({
      period_year: 2024,
      period_kind: 'annual',
      category3: '재료비',
      account: '재료비',
      value_mwon: 9999,
    }),
    // 변동비율 행(isCost 아님) — 제외
    fv({ period_year: 0, cost_type: '변동비율', account: '감가상각비', value_mwon: 0.3 }),
    // 2026 monthly 1~4 = 1000 → 10억
    fv({
      period_year: 2026,
      period_kind: 'monthly',
      period_month: 1,
      account: '감가상각비',
      value_mwon: 250,
    }),
    fv({
      period_year: 2026,
      period_kind: 'monthly',
      period_month: 2,
      account: '감가상각비',
      value_mwon: 250,
    }),
    fv({
      period_year: 2026,
      period_kind: 'monthly',
      period_month: 3,
      account: '감가상각비',
      value_mwon: 250,
    }),
    fv({
      period_year: 2026,
      period_kind: 'monthly',
      period_month: 4,
      account: '감가상각비',
      value_mwon: 250,
    }),
    // 2026 month 5 — 최신월(4) 초과 → 제외돼야 함
    fv({
      period_year: 2026,
      period_kind: 'monthly',
      period_month: 5,
      account: '감가상각비',
      value_mwon: 9999,
    }),
  ];
  const result = buildPnlDerived(preparePnlData(pnlData), fixedVariable);

  it('영업이익(억원) — 2024 연간 80, 2026 YTD 10', () => {
    expect(result.opIncome).toEqual([
      { year: 2024, eok: 80 },
      { year: 2026, eok: 10 },
    ]);
  });
  it('상각비 합계(억원) — 2024 연간 15(감가1000+개발상각500), 2026 YTD 10(월5 제외)', () => {
    expect(result.depreciation).toEqual([
      { year: 2024, eok: 15 },
      { year: 2026, eok: 10 },
    ]);
  });
  it('진행 연도·최신월 = 2026·4', () => {
    expect(result.currentYear).toBe(2026);
    expect(result.currentYearLatestMonth).toBe(4);
  });
});
