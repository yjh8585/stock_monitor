// 가이던스 신호등 시험(A10) — 숫자는 임의 · 가짜 회사.
import { describe, expect, it } from 'vitest';
import type { GuidanceRowTs } from './ir';
import { guidanceSignal, midOf, singleDigitRange } from './signals';
import type { CustomerEarningsPoint } from './types';

describe('singleDigitRange', () => {
  it('낮은 1~3 · 중간 4~6 · 높은 7~9 · 감소 낱말이면 음수 · 아니면 null', () => {
    expect(singleDigitRange('Low-Single Digit %')).toEqual({ low: 1, high: 3 });
    expect(singleDigitRange('mid single digits increase')).toEqual({ low: 4, high: 6 });
    expect(singleDigitRange('High-single digit decline')).toEqual({ low: -9, high: -7 });
    expect(singleDigitRange('Improved Y-o-Y')).toBeNull();
    expect(singleDigitRange(null)).toBeNull();
  });

  it('「lower end of」·「down to」는 범위의 아래쪽이지 감소가 아니다', () => {
    expect(singleDigitRange('at the lower end of mid-single digit')).toEqual({ low: 4, high: 6 });
    expect(singleDigitRange('down to low single digits')).toEqual({ low: 1, high: 3 });
    expect(singleDigitRange('low single digit lower')).toEqual({ low: -3, high: -1 });
  });
});

const row = (over: Partial<GuidanceRowTs>): GuidanceRowTs => ({
  metric: 'operating_margin',
  metric_label: 'Return on sales',
  period: 'FY2026',
  low: 5,
  high: 7,
  value_text: null,
  unit: 'percent',
  basis: null,
  currency: null,
  stated: null,
  direction: 'initiated',
  extractor: 'code',
  quote: 'q',
  published_at: '2026-03-01',
  verified: true,
  ...over,
});

const card = (history: GuidanceRowTs[], withdrawn_at: string | null = null) => ({
  metric: history[0].metric,
  current: history.at(-1)!,
  history,
  withdrawn_at,
  currency: null,
});

const prior = (over: Partial<CustomerEarningsPoint>): CustomerEarningsPoint => ({
  period_label: '2025',
  fiscal_year: 2025,
  fiscal_quarter: null,
  revenue_bn: 100,
  operating_income_bn: 5,
  operating_margin_pct: 5,
  net_income_bn: 3,
  revenue_yoy_pct: null,
  ...over,
});

describe('midOf', () => {
  it('범위는 중간값 · 한쪽만 있으면 그 값 · 없으면 null', () => {
    expect(midOf({ low: 5, high: 7 })).toBe(6);
    expect(midOf({ low: null, high: 4 })).toBe(4);
    expect(midOf({ low: null, high: null })).toBeNull();
  });
});

describe('guidanceSignal', () => {
  it('철회 → 빨강', () => {
    expect(guidanceSignal(card([row({})], '2026-07-01'), null, 'EUR').color).toBe('red');
  });

  it('연초 첫 전망보다 낮은 값을 「유지」해도 빨강', () => {
    const s = guidanceSignal(
      card([
        row({ low: 5.5, high: 7, published_at: '2026-03-01' }),
        row({ low: 2, high: 3, direction: 'lowered', published_at: '2026-07-01' }),
        row({ low: 2, high: 3, direction: 'maintained', published_at: '2026-10-01' }),
      ]),
      prior({ operating_margin_pct: 1 }),
      'EUR'
    );
    expect(s.color).toBe('red');
    expect(s.reason).toContain('첫 전망');
  });

  it('이익률 목표 < 전년 실적 → 빨강', () => {
    const s = guidanceSignal(
      card([row({ low: 3, high: 4 })]),
      prior({ operating_margin_pct: 5 }),
      'EUR'
    );
    expect(s.color).toBe('red');
  });

  it('이익률 개선 0.5%p 미만 → 노랑 · 이상 → 초록', () => {
    expect(
      guidanceSignal(
        card([row({ low: 5.2, high: 5.2 })]),
        prior({ operating_margin_pct: 5 }),
        'EUR'
      ).color
    ).toBe('yellow');
    expect(
      guidanceSignal(
        card([row({ low: 5.5, high: 5.5 })]),
        prior({ operating_margin_pct: 5 }),
        'EUR'
      ).color
    ).toBe('green');
  });

  it('매출 성장률 전망: 음수 빨강 · 0~3% 노랑 · 3% 초과 초록', () => {
    const g = (low: number, high: number) =>
      guidanceSignal(card([row({ metric: 'revenue_growth', low, high })]), null, 'EUR').color;
    expect(g(-3, -1)).toBe('red');
    expect(g(0, 3)).toBe('yellow');
    expect(g(3, 5)).toBe('green');
  });

  it('매출 금액 전망은 전년 실적 매출과 견준다(단위 환산 · 같은 통화만)', () => {
    const c = card([row({ metric: 'revenue', low: 102, high: 102, unit: 'billion' })]);
    expect(guidanceSignal(c, prior({ revenue_bn: 100 }), 'EUR').color).toBe('yellow');
    expect(guidanceSignal(c, prior({ revenue_bn: 110 }), 'EUR').color).toBe('red');
    // 카드 통화가 실적 통화와 다르면 견주지 않는다 → 비교 대상 없음
    expect(guidanceSignal({ ...c, currency: 'USD' }, prior({ revenue_bn: 110 }), 'EUR').color).toBe(
      'gray'
    );
  });

  it('조정 매출 전망도 전년 매출과 같은 문턱으로 견준다 — 첫 전망보다 올랐어도', () => {
    const c = card([
      row({ metric: 'adjusted_sales', low: 100, high: 100, unit: 'billion' }),
      row({
        metric: 'adjusted_sales',
        low: 102,
        high: 102,
        unit: 'billion',
        direction: 'raised',
        published_at: '2026-07-01',
      }),
    ]);
    expect(guidanceSignal(c, prior({ revenue_bn: 100 }), 'EUR').color).toBe('yellow');
  });

  it('조 단위 매출 전망도 십억으로 맞춰 견준다', () => {
    const c = card([row({ metric: 'revenue', low: 120, high: 120, unit: 'trillion' })]);
    expect(guidanceSignal(c, prior({ revenue_bn: 100_000 }), 'KRW').color).toBe('green');
  });

  it('투자·특별 요인은 회색(방향 판정 안 함) — 첫 전망보다 낮아져도', () => {
    const capex = card([
      row({ metric: 'capex', unit: 'billion', low: 10, high: 10 }),
      row({ metric: 'capex', unit: 'billion', low: 8, high: 8, published_at: '2026-07-01' }),
    ]);
    expect(guidanceSignal(capex, null, 'USD').color).toBe('gray');
  });

  it('회사 조정 이익률 전망은 전년 «조정» 영업이익 ÷ 매출과 견준다(법정 이익률 아님)', () => {
    const aoi = (v: string) =>
      card([row({ metric: 'aoi_margin', unit: 'text', low: null, high: null, value_text: v })]);
    // 법정 이익률은 1% 지만 전년 AOI 이익률은 5% → 「낮은 한 자릿수」(1~3%) 전망은 낮아짐 = 빨강
    const p = prior({
      revenue_bn: 100,
      operating_margin_pct: 1,
      adjusted: [{ metric: 'aoi', name: 'AOI', value_bn: 5 }],
    });
    const s = guidanceSignal(aoi('Low-Single Digit %'), p, 'EUR');
    expect(s.color).toBe('red');
    expect(s.reason).toContain('AOI 이익률 5.0%');
    // 전년 조정 영업이익이 없으면 법정 이익률로 대신 견주지 않는다 → 회색
    expect(guidanceSignal(aoi('Low-Single Digit %'), prior({}), 'EUR').color).toBe('gray');
  });

  it('첫 전망과 단위를 바꿀 수 없으면(대수 ↔ %) 견주지 않는다', () => {
    const c = card([
      row({ metric: 'deliveries', unit: 'units', low: 9_000_000, high: 9_000_000 }),
      row({
        metric: 'deliveries',
        unit: 'text',
        low: null,
        high: null,
        value_text: 'mid single digit',
        published_at: '2026-07-01',
      }),
    ]);
    expect(guidanceSignal(c, null, null).color).toBe('gray');
  });

  it('단위 환산의 소수 오차는 상향·하향으로 치지 않는다', () => {
    // 4.1 백만 → 0.0040999…(십억) · 16.1 백만 → 0.0161000…03 — 오차 폭이 없으면 각각 초록·빨강이 된다.
    const c = (m: number, b: number) =>
      card([
        row({ metric: 'order_intake', unit: 'million', low: m, high: m }),
        row({
          metric: 'order_intake',
          unit: 'billion',
          low: b,
          high: b,
          published_at: '2026-07-01',
        }),
      ]);
    expect(guidanceSignal(c(4.1, 0.0041), null, 'EUR').color).toBe('gray');
    expect(guidanceSignal(c(16.1, 0.0161), null, 'EUR').color).toBe('gray');
  });

  it('장부상 이익률 전망은 전년 점의 영업이익이 «조정» 값이면 견주지 않는다', () => {
    const adjustedPrior = prior({
      operating_margin_pct: 9,
      origin: {
        revenue: { source: 'company_reported' },
        operating_income: { source: 'company_adjusted', metric_name: 'Operating result' },
        net_income: { source: 'company_reported' },
      },
    });
    const s = guidanceSignal(card([row({ low: 3, high: 4 })]), adjustedPrior, 'EUR');
    expect(s.color).toBe('gray');
    expect(s.reason).toContain('전년 실적과 견줄 수 없음');
  });

  it('회색 이유는 사실대로 — 전년과 견주지 않는 지표면 「실적 없음」이라 하지 않는다', () => {
    const s = guidanceSignal(
      card([row({ metric: 'operating_income', unit: 'billion' })]),
      prior({}),
      'EUR'
    );
    expect(s.color).toBe('gray');
    expect(s.reason).toContain('매출·이익률만 견줌');
    expect(s.reason).not.toContain('실적 없음');
  });

  it('견줄 전년 실적이 없으면 첫 전망보다 오르면 초록 · 그대로면 회색', () => {
    const up = card([
      row({ metric: 'deliveries', unit: 'units', low: 100, high: 110 }),
      row({
        metric: 'deliveries',
        unit: 'units',
        low: 105,
        high: 115,
        direction: 'raised',
        published_at: '2026-07-01',
      }),
    ]);
    expect(guidanceSignal(up, null, null).color).toBe('green');
    expect(
      guidanceSignal(card([row({ metric: 'deliveries', unit: 'units' })]), null, null).color
    ).toBe('gray');
  });

  it('「한 자릿수」 문구는 % 범위로 읽어 판정하고 이유에 해석을 밝힌다', () => {
    const t = (v: string, d = 'initiated', at = '2026-03-01') =>
      row({
        metric: 'revenue_growth',
        unit: 'text',
        low: null,
        high: null,
        value_text: v,
        direction: d,
        published_at: at,
      });
    const mid = guidanceSignal(card([t('Mid-Single Digit % Increase')]), null, 'EUR');
    expect(mid.color).toBe('green');
    expect(mid.reason).toContain('해석');
    expect(guidanceSignal(card([t('Low-Single Digit %')]), null, 'EUR').color).toBe('yellow');
    // 첫 전망 「중간」 → 지금 「낮은」 = 첫 전망보다 낮아짐 → 빨강
    expect(
      guidanceSignal(
        card([t('mid-single digit'), t('low-single digit', 'lowered', '2026-07-01')]),
        null,
        'EUR'
      ).color
    ).toBe('red');
  });

  it('숫자 없는 문구 전망은 이력의 상향·하향 수로', () => {
    const t = (d: string) =>
      row({
        metric: 'aoi_margin',
        unit: 'text',
        low: null,
        high: null,
        value_text: 'x',
        direction: d,
      });
    expect(guidanceSignal(card([t('initiated'), t('lowered')]), null, 'EUR').color).toBe('red');
    expect(guidanceSignal(card([t('initiated'), t('raised')]), null, 'EUR').color).toBe('green');
  });
});
