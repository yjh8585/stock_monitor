import { describe, expect, it } from 'vitest';
import { buildEarnings, quarterRows, ytdAnnualPoint } from './earnings';
import type { CustomerEarningsPoint, FinancialPeriodRow } from './types';

const pt = (
  y: number,
  qt: number | null,
  revenue: number | null,
  oi: number | null = null,
  ni: number | null = null
): CustomerEarningsPoint => ({
  period_label: qt == null ? String(y) : `${y}Q${qt}`,
  fiscal_year: y,
  fiscal_quarter: qt,
  revenue_bn: revenue,
  operating_income_bn: oi,
  operating_margin_pct: null,
  net_income_bn: ni,
  revenue_yoy_pct: null,
});

describe('quarterRows — 매출 QoQ · 누적(A8)', () => {
  const qs = [pt(2025, 4, 100, 5), pt(2026, 1, 80, 4), pt(2026, 2, 120, 6), pt(2026, 3, 90, -3)];
  const rows = quarterRows(qs);
  it('1분기 QoQ 는 전년 4분기와 견준다', () => {
    expect(rows[1].revenue_qoq_pct).toBeCloseTo(-20);
  });
  it('같은 해 앞 분기와 견준다', () => {
    expect(rows[2].revenue_qoq_pct).toBeCloseTo(50);
  });
  it('누적 = 그해 1분기~이 분기 합(전년 분기는 섞지 않는다)', () => {
    expect(rows[3].ytd_revenue_bn).toBe(290);
    expect(rows[3].ytd_operating_income_bn).toBe(7);
    expect(rows[1].ytd_revenue_bn).toBe(80);
  });
  it('앞 분기가 비면 누적도 null(0 으로 치지 않는다)', () => {
    const gap = quarterRows([pt(2026, 1, null), pt(2026, 2, 50)]);
    expect(gap[1].ytd_revenue_bn).toBeNull();
    expect(gap[1].revenue_qoq_pct).toBeNull();
  });
  it('분기마다 영업이익 출처(장부상·회사 조정)가 다르면 누적 영업이익을 더하지 않는다', () => {
    const src = (s: 'company_reported' | 'company_adjusted') => ({
      revenue: { source: 'company_reported' as const },
      operating_income: { source: s },
      net_income: { source: 'company_reported' as const },
    });
    const mixed = quarterRows([
      { ...pt(2026, 1, 80, 4), origin: src('company_adjusted') },
      { ...pt(2026, 2, 120, 6), origin: src('company_reported') },
    ]);
    expect(mixed[1].ytd_operating_income_bn).toBeNull();
    expect(mixed[1].ytd_revenue_bn).toBe(200);
    const same = quarterRows([
      { ...pt(2026, 1, 80, 4), origin: src('company_adjusted') },
      { ...pt(2026, 2, 120, 6), origin: src('company_adjusted') },
    ]);
    expect(same[1].ytd_operating_income_bn).toBe(10);
  });
});

describe('ytdAnnualPoint — 연간 보기의 올해 YTD 행(A8)', () => {
  const qs = [
    pt(2025, 1, 70, 3, 2),
    pt(2025, 2, 100, 5, 3),
    pt(2026, 1, 80, 4, 1),
    pt(2026, 2, 120, 6, 2),
  ];
  it('가장 늦은 해가 연간 목록에 없으면 1~마지막 분기 합 · 전년 같은 분기 합과 YoY', () => {
    const y = ytdAnnualPoint(qs, [pt(2025, null, 400)]);
    expect(y).toMatchObject({
      period_label: '2026 YTD(1~2분기)',
      revenue_bn: 200,
      operating_income_bn: 10,
      net_income_bn: 3,
    });
    expect(y?.operating_margin_pct).toBeCloseTo(5);
    expect(y?.revenue_yoy_pct).toBeCloseTo(((200 - 170) / 170) * 100);
  });
  it('그해 연간 행이 이미 있으면 null', () => {
    expect(ytdAnnualPoint(qs, [pt(2026, null, 500)])).toBeNull();
  });
  it('그해 1분기가 비면 null', () => {
    expect(ytdAnnualPoint([pt(2026, 2, 50)], [])).toBeNull();
  });
  it('1분기만 있는 해는 「1분기」 라벨', () => {
    expect(ytdAnnualPoint([pt(2026, 1, 50)], [])?.period_label).toBe('2026 YTD(1분기)');
  });
  it('합친 분기들의 영업이익 출처가 같으면 YTD 행에 싣는다(표가 「조정」을 밝힌다)', () => {
    const o = {
      revenue: { source: 'company_reported' as const },
      operating_income: { source: 'company_adjusted' as const, metric_name: 'AOI' },
      net_income: { source: 'company_reported' as const },
    };
    const y = ytdAnnualPoint(
      [
        { ...pt(2026, 1, 80, 4), origin: o },
        { ...pt(2026, 2, 120, 6), origin: o },
      ],
      []
    );
    expect(y?.origin?.operating_income).toEqual({ source: 'company_adjusted', metric_name: 'AOI' });
    // 출처 표시가 없는 점(국내)이면 싣지 않는다
    expect(ytdAnnualPoint(qs, [])?.origin).toBeUndefined();
  });
});

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

  it('전년 같은 분기 매출이 0 이면 YoY null(0 나눗셈 보호)', () => {
    const r = buildEarnings([q(2025, 1, 0), q(2026, 1, 1100)]);
    expect(r.quarterly[1].revenue_yoy_pct).toBeNull();
  });

  it('매출이 전부 null 이어도 영업이익이 있으면 그 통화로 점을 만든다', () => {
    const r = buildEarnings([q(2026, 1, null, { operating_income: 50 })]);
    expect(r.currency).toBe('USD');
    expect(r.quarterly).toHaveLength(1);
    expect(r.quarterly[0].revenue_bn).toBeNull();
    expect(r.quarterly[0].operating_income_bn).toBe(0.05);
  });

  it('행이 없으면 통화 null·빈 배열', () => {
    expect(buildEarnings([])).toEqual({ currency: null, quarterly: [], annual: [] });
  });
});
