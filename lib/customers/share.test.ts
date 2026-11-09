import { describe, expect, it } from 'vitest';
import { computeShares } from './share';
import type { PnlRevenueRow } from './types';

const row = (
  customer: string,
  product: string,
  y: number,
  m: number,
  revenue: number | null
): PnlRevenueRow => ({
  customer,
  product,
  period_year: y,
  period_month: m,
  revenue,
});

describe('computeShares', () => {
  it('최신월로 끝나는 12개월만 센다', () => {
    const rows = [
      row('가나자동차', '부품A', 2025, 9, 1000), // 창 밖(2025.10~2026.09)
      row('가나자동차', '부품A', 2025, 10, 30),
      row('다라그룹', '부품B', 2026, 9, 70),
    ];
    const r = computeShares(rows, [{ company_id: 'c1', pnl_customers: ['가나자동차'] }]);
    expect(r.windowLabel).toBe('2025.10~2026.09');
    expect(r.byCompany.c1.sharePct).toBeCloseTo(30);
  });

  it('여러 손익 고객명을 한 회사로 합친다', () => {
    const rows = [
      row('가나 북미', 'A', 2026, 1, 20),
      row('가나 유럽', 'A', 2026, 1, 30),
      row('기타사', 'B', 2026, 1, 50),
    ];
    const r = computeShares(rows, [
      { company_id: 'c1', pnl_customers: ['가나 북미', '가나 유럽'] },
    ]);
    expect(r.byCompany.c1.sharePct).toBeCloseTo(50);
  });

  it('손익 고객명이 없으면 null(해당 없음)', () => {
    const r = computeShares(
      [row('기타사', 'B', 2026, 1, 50)],
      [{ company_id: 'c2', pnl_customers: [] }]
    );
    expect(r.byCompany.c2.sharePct).toBeNull();
    expect(r.byCompany.c2.topProducts).toEqual([]);
  });

  it('상위 품목은 매출 순 최대 3개', () => {
    const rows = [
      row('가나자동차', 'P1', 2026, 1, 10),
      row('가나자동차', 'P2', 2026, 1, 40),
      row('가나자동차', 'P3', 2026, 1, 30),
      row('가나자동차', 'P4', 2026, 1, 20),
    ];
    const r = computeShares(rows, [{ company_id: 'c1', pnl_customers: ['가나자동차'] }]);
    expect(r.byCompany.c1.topProducts).toEqual(['P2', 'P3', 'P4']);
  });

  it('창 안에 매핑 고객 행이 하나도 없으면 0% 가 아니라 null', () => {
    const r = computeShares(
      [row('기타사', 'B', 2026, 1, 50)],
      [{ company_id: 'c1', pnl_customers: ['가나자동차'] }]
    );
    expect(r.byCompany.c1.sharePct).toBeNull();
    expect(r.byCompany.c1.topProducts).toEqual([]);
  });

  it('창 안 총매출이 0 이면 null(0 나눗셈 보호)', () => {
    const r = computeShares(
      [row('가나자동차', 'A', 2026, 1, 0), row('기타사', 'B', 2026, 1, 0)],
      [{ company_id: 'c1', pnl_customers: ['가나자동차'] }]
    );
    expect(r.byCompany.c1.sharePct).toBeNull();
  });

  it('null 매출은 건너뛴다 · 값 있는 행이 없으면 빈 결과', () => {
    const r = computeShares(
      [row('가나자동차', 'A', 2026, 1, null)],
      [{ company_id: 'c1', pnl_customers: ['가나자동차'] }]
    );
    expect(r.windowLabel).toBe('');
    expect(r.byCompany.c1.sharePct).toBeNull();
  });
});
