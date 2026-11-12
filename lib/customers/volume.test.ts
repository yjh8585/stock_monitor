import { describe, expect, it } from 'vitest';
import { aggregateMonthlySeries } from '@/lib/oem-companies/kg-mobility/aggregate';
import {
  groupMonthToSaleRows,
  modelMonthsToGroupMonth,
  modelQuarterTable,
  monthlyToQuarterly,
} from './volume';

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

// 묶음 그룹 안의 회사 — 가짜 차종(Acme A1·A2)으로.
describe('차종 모드(marklines_models) — 월 합 · 차종별 분기 표', () => {
  const r = (model: string, year_month: number, value: number) => ({ model, year_month, value });

  it('나라별·차종별 행을 월 합 하나로 · 월 오름차순', () => {
    const out = modelMonthsToGroupMonth(
      [r('Acme A1', 202602, 5), r('Acme A1', 202601, 10), r('Acme A2', 202601, 3)],
      '묶음그룹'
    );
    expect(out).toEqual([
      { oem_group: '묶음그룹', year_month: 202601, sales: 13 },
      { oem_group: '묶음그룹', year_month: 202602, sales: 5 },
    ]);
  });

  it('첫 달~끝 달 사이 빈 달(0대 — 적재기가 행을 안 남긴다)은 0 으로 채운다 · 해 넘김', () => {
    const out = modelMonthsToGroupMonth([r('Acme A1', 202511, 4), r('Acme A1', 202602, 6)], 'g');
    expect(out.map((m) => [m.year_month, m.sales])).toEqual([
      [202511, 4],
      [202512, 0],
      [202601, 0],
      [202602, 6],
    ]);
  });

  it('석 달이 다 든 분기만 값 · 생산 블록 먼저 · 분기에 행 없는 차종은 —(null)', () => {
    const q3 = [202607, 202608, 202609];
    const production = [
      ...[202604, 202605, 202606, ...q3].map((m) => r('Acme A1', m, 100)),
      ...q3.map((m) => r('Acme A2', m, 50)), // 신차 — 2분기엔 행이 없다
    ];
    const sales = [
      ...[202604, 202605, 202606, ...q3, 202610].map((m) => r('Acme A1', m, 90)),
      r('Acme A2', 202609, 30),
    ];
    const t = modelQuarterTable(production, sales)!;
    expect(t.periods).toEqual(['2026-Q2', '2026-Q3']); // 4분기는 10월뿐이라 빠진다
    expect(t.rows).toEqual([
      { model: 'Acme A1', kind: 'production', values: [300, 300] },
      { model: 'Acme A2', kind: 'production', values: [null, 150] },
      { model: 'Acme A1', kind: 'sales', values: [270, 270] },
      { model: 'Acme A2', kind: 'sales', values: [null, 30] },
    ]);
  });

  it('한 갈래만 석 달이 차면 다른 갈래 칸은 비운다(생산이 한 달 늦다)', () => {
    const production = [202607, 202608].map((m) => r('Acme A1', m, 100));
    const sales = [202607, 202608, 202609].map((m) => r('Acme A1', m, 90));
    const t = modelQuarterTable(production, sales)!;
    expect(t.periods).toEqual(['2026-Q3']);
    expect(t.rows).toEqual([{ model: 'Acme A1', kind: 'sales', values: [270] }]);
  });

  it('분기가 하나도 안 차면 null', () => {
    expect(modelQuarterTable([r('Acme A1', 202607, 1)], [])).toBeNull();
  });
});
