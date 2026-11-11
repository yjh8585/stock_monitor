// 고객사 공식 문서 조회 계층 순수 함수 시험 — 가짜 회사 Acme Motors · 숫자는 임의(실물과 같은 «꼴»만 빌렸다).
import { describe, expect, it } from 'vitest';
import {
  buildVolumeSeries,
  CHINA_JV_METRIC,
  droppedCurrencies,
  guidanceStatusNotes,
  latestChinaJv,
  latestGuidance,
  latestGuidanceChange,
  nextEarnings,
  pickEarnings,
  quarterize,
  regionQuarterCharts,
  type GuidanceRowTs,
  type ReportedRow,
  type VolumeRow,
  type VolumeSeries,
} from './ir';
import type { CustomerEarnings, CustomerEarningsPoint } from './types';

describe('quarterize', () => {
  it('누계를 빼서 분기를 만든다(포르쉐형)', () => {
    const q = quarterize([
      { period_grain: 'quarter', period: '2026-Q1', value: 60 },
      { period_grain: 'ytd', period: '2026-6M', value: 130 },
      { period_grain: 'ytd', period: '2026-9M', value: 180 },
    ]);
    expect(q).toEqual([
      { period: '2026-Q1', value: 60, derived: false },
      { period: '2026-Q2', value: 70, derived: true },
      { period: '2026-Q3', value: 50, derived: true },
    ]);
  });
  it('빼기 재료가 없으면 만들지 않는다', () => {
    expect(quarterize([{ period_grain: 'ytd', period: '2026-9M', value: 180 }])).toEqual([]);
  });
  it('분기 행이 있으면 누계 차이보다 우선', () => {
    const q = quarterize([
      { period_grain: 'quarter', period: '2026-Q3', value: 51 },
      { period_grain: 'ytd', period: '2026-6M', value: 130 },
      { period_grain: 'ytd', period: '2026-9M', value: 180 },
    ]);
    expect(q.find((p) => p.period === '2026-Q3')).toEqual({
      period: '2026-Q3',
      value: 51,
      derived: false,
    });
  });
});

// ---------------------------------------------------------------- 가이던스
const g = (over: Partial<GuidanceRowTs>): GuidanceRowTs => ({
  metric: 'deliveries',
  metric_label: 'Vehicles Delivered',
  period: 'FY2026',
  low: 62000,
  high: 67000,
  value_text: null,
  unit: 'units',
  basis: null,
  currency: null,
  stated: null,
  direction: 'initiated',
  extractor: 'code',
  quote: 'q',
  published_at: '2026-02-12',
  verified: true,
  ...over,
});

describe('latestGuidance', () => {
  it('검증 안 된 행은 버리고 최신 FY 의 최신 행 + 이력', () => {
    const cards = latestGuidance(
      [
        g({}),
        g({ low: 65000, high: 70000, direction: 'raised', published_at: '2026-07-02' }),
        g({ low: 1, high: 2, direction: 'lowered', published_at: '2026-08-01', verified: false }),
      ],
      2026
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].current.low).toBe(65000);
    expect(cards[0].history.map((h) => h.direction)).toEqual(['initiated', 'raised']);
  });

  it('상태 행(metric=other)은 카드가 되지 않는다 — 숫자 지표로 취급하지 않는다', () => {
    const cards = latestGuidance(
      [
        g({}),
        g({
          metric: 'other',
          metric_label: 'Guidance',
          low: null,
          high: null,
          value_text: 'reaffirmed',
          unit: 'text',
          stated: 'maintained',
          direction: 'maintained',
          published_at: '2026-09-30',
        }),
      ],
      2026
    );
    expect(cards.map((c) => c.metric)).toEqual(['deliveries']);
    expect(cards[0].current.published_at).toBe('2026-02-12');
  });

  it('같은 FY 에 철회 행이 «뒤에» 있으면 그 FY 카드가 철회됨 · 철회 뒤 새로 낸 전망은 아니다', () => {
    const withdraw = (d: string) =>
      g({
        metric: 'other',
        period: 'FY2025',
        low: null,
        high: null,
        value_text: 'withdrawn',
        unit: 'text',
        stated: 'withdrawn',
        direction: 'withdrawn',
        published_at: d,
      });
    const cards = latestGuidance(
      [
        g({ metric: 'revenue_growth', period: 'FY2025', unit: 'text', published_at: '2025-01-28' }),
        g({
          metric: 'adjusted_sales',
          period: 'FY2025',
          unit: 'billion',
          published_at: '2025-10-28',
        }),
        withdraw('2025-04-29'),
        withdraw('2025-07-29'),
      ],
      2025
    );
    const by = Object.fromEntries(cards.map((c) => [c.metric, c]));
    expect(by.revenue_growth.withdrawn_at).toBe('2025-04-29');
    expect(by.adjusted_sales.withdrawn_at).toBeNull();
  });

  it('통화가 다르면 같은 metric 이라도 한 카드로 합치지 않는다 · null 은 회사 기준 통화', () => {
    const cards = latestGuidance(
      [
        g({ metric: 'order_intake', unit: 'million', currency: 'USD', published_at: '2026-07-24' }),
        g({ metric: 'order_intake', unit: 'million', currency: null, published_at: '2026-01-30' }),
        g({ metric: 'order_intake', unit: 'million', currency: 'KRW', published_at: '2026-03-02' }),
      ],
      2026,
      'KRW'
    );
    const byCur = Object.fromEntries(cards.map((c) => [c.currency ?? '', c]));
    expect(Object.keys(byCur).sort()).toEqual(['KRW', 'USD']);
    expect(byCur.USD.history).toHaveLength(1);
    expect(byCur.KRW.history.map((h) => h.published_at)).toEqual(['2026-01-30', '2026-03-02']);
  });

  it('중장기 목표(FY2030)가 올해 전망(FY2026)을 가리지 않는다 — 대표는 올해, 먼 FY 는 longer_term', () => {
    const cards = latestGuidance(
      [
        g({
          metric: 'operating_margin',
          unit: 'percent',
          period: 'FY2025',
          published_at: '2025-01-20',
        }),
        g({
          metric: 'operating_margin',
          unit: 'percent',
          period: 'FY2026',
          published_at: '2026-01-29',
        }),
        g({
          metric: 'operating_margin',
          unit: 'percent',
          period: 'FY2030',
          direction: 'lowered',
          published_at: '2026-04-09',
        }),
        g({
          metric: 'operating_margin',
          unit: 'percent',
          period: 'FY2030',
          published_at: '2025-04-10',
        }),
      ],
      2026
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].period).toBe('FY2026');
    expect(cards[0].current.published_at).toBe('2026-01-29');
    expect(
      cards[0].longer_term.map((t) => [t.period, t.history.length, t.current.direction])
    ).toEqual([['FY2030', 2, 'lowered']]);
  });

  it('올해 이후 FY 가 없으면(작년 전망만 남음) 가장 늦은 FY 가 대표 · 철회도 그 FY 기준', () => {
    const cards = latestGuidance(
      [
        g({ period: 'FY2024', published_at: '2024-02-01' }),
        g({ period: 'FY2025', published_at: '2025-02-01' }),
        g({
          metric: 'other',
          period: 'FY2025',
          low: null,
          high: null,
          value_text: 'withdrawn',
          unit: 'text',
          stated: 'withdrawn',
          published_at: '2025-04-30',
        }),
      ],
      2026
    );
    expect(cards[0].period).toBe('FY2025');
    expect(cards[0].withdrawn_at).toBe('2025-04-30');
    expect(cards[0].longer_term).toEqual([]);
  });

  // 가나자동차 꼴 — 같은 날 DART 공시(code)와 IR 자료(llm)가 같은 전망을 따로 낸다. 행은 id 순(코드가 먼저 적재)으로 온다.
  const capex = (over: Partial<GuidanceRowTs>) =>
    g({
      metric: 'capex',
      metric_label: '투자계획',
      low: 17.8,
      high: 17.8,
      unit: 'trillion',
      ...over,
    });

  it('같은 날 같은 값(code + llm)은 한 줄로 접고 코드 추출을 남긴다 — 이력 부풀림·current 가 AI 행이 되는 것 방지', () => {
    const rows = [
      capex({ published_at: '2026-01-29' }),
      capex({ published_at: '2026-10-29', low: 16, high: 16, direction: 'lowered' }),
      capex({ published_at: '2026-01-29', extractor: 'llm', metric_label: '부문 투자계획' }),
      capex({
        published_at: '2026-10-29',
        low: 16,
        high: 16,
        direction: 'lowered',
        extractor: 'llm',
        metric_label: '투자계획(부문)',
      }),
    ];
    const [card] = latestGuidance(rows, 2026);
    expect(card.history.map((h) => [h.published_at, h.extractor])).toEqual([
      ['2026-01-29', 'code'],
      ['2026-10-29', 'code'],
    ]);
    expect(card.current.extractor).toBe('code');
    expect(card.current.metric_label).toBe('투자계획');
    // 입력 순서가 뒤집혀도(AI 행이 먼저 와도) 코드 행이 남는다
    expect(latestGuidance([...rows].reverse(), 2026)[0].history.map((h) => h.extractor)).toEqual([
      'code',
      'code',
    ]);
  });

  it('같은 날 코드 두 행이 같은 값이면 한 줄(먼저 온 행)', () => {
    const [card] = latestGuidance(
      [
        g({ metric: 'sales_units', metric_label: '판매목표(대수)', published_at: '2026-10-29' }),
        g({ metric: 'sales_units', metric_label: '판매목표', published_at: '2026-10-29' }),
      ],
      2026
    );
    expect(card.history.map((h) => h.metric_label)).toEqual(['판매목표(대수)']);
  });

  it('같은 날 값이 다르면 둘 다 남기되 코드 행이 뒤(= current) — 입력 순서와 무관', () => {
    const code = capex({ published_at: '2026-10-29', low: 16, high: 16 });
    const llm = capex({ published_at: '2026-10-29', low: 15.5, high: 15.5, extractor: 'llm' });
    for (const rows of [
      [code, llm],
      [llm, code],
    ]) {
      const [card] = latestGuidance(rows, 2026);
      expect(card.history.map((h) => [h.extractor, h.low])).toEqual([
        ['llm', 15.5],
        ['code', 16],
      ]);
      expect(card.current).toBe(code);
    }
  });

  it('같은 날·같은 값이라도 기준(조정/장부)이 다르면 접지 않는다', () => {
    const [card] = latestGuidance(
      [
        capex({ published_at: '2026-10-29', basis: 'reported' }),
        capex({ published_at: '2026-10-29', basis: 'adjusted', extractor: 'llm' }),
      ],
      2026
    );
    expect(card.history.map((h) => h.basis)).toEqual(['adjusted', 'reported']);
  });

  it('날짜가 다르면 같은 값이라도 접지 않는다(유지 확인 이력)', () => {
    const [card] = latestGuidance(
      [
        capex({ published_at: '2026-01-29', extractor: 'llm' }),
        capex({ published_at: '2026-10-29', direction: 'maintained' }),
      ],
      2026
    );
    expect(card.history.map((h) => h.published_at)).toEqual(['2026-01-29', '2026-10-29']);
  });
});

describe('guidanceStatusNotes', () => {
  it('검증된 상태 행만 날짜순', () => {
    const notes = guidanceStatusNotes([
      g({}),
      g({ metric: 'other', stated: 'withdrawn', value_text: 'w', published_at: '2025-07-29' }),
      g({ metric: 'other', stated: 'maintained', value_text: 'm', published_at: '2025-04-29' }),
      g({ metric: 'other', stated: 'withdrawn', published_at: '2025-08-01', verified: false }),
    ]);
    expect(notes.map((n) => n.stated)).toEqual(['maintained', 'withdrawn']);
  });
});

describe('latestGuidanceChange', () => {
  it('가장 최근 상향·하향 1건 + 그 FY 가 뒤에 철회됐는지', () => {
    const rows = [
      g({ direction: 'raised', published_at: '2026-03-03' }),
      g({ direction: 'lowered', published_at: '2026-05-01', metric_label: 'Deliveries' }),
      g({ direction: 'maintained', published_at: '2026-07-01' }),
      g({ direction: 'raised', published_at: '2026-09-01', verified: false }),
    ];
    expect(latestGuidanceChange(rows, 2026)).toEqual({
      metric_label: 'Deliveries',
      direction: 'lowered',
      period: 'FY2026',
      published_at: '2026-05-01',
      withdrawn_at: null,
    });
    expect(latestGuidanceChange([g({ direction: 'maintained' })], 2026)).toBeNull();
  });

  it('카드와 같은 대표 FY 기준 — 올해 전망은 유지, 먼 목표(FY2030)만 하향이면 「변경 없음」(null)', () => {
    const rows = [
      g({
        metric: 'operating_margin',
        period: 'FY2026',
        direction: 'maintained',
        published_at: '2026-04-09',
      }),
      g({
        metric: 'operating_margin',
        period: 'FY2030',
        direction: 'lowered',
        published_at: '2026-04-09',
      }),
    ];
    expect(latestGuidanceChange(rows, 2026)).toBeNull();
    // 같은 행이라도 대표 FY 의 변경이면 잡는다
    expect(
      latestGuidanceChange(
        [
          ...rows,
          g({
            metric: 'revenue',
            period: 'FY2026',
            direction: 'raised',
            published_at: '2026-01-20',
          }),
        ],
        2026
      )?.period
    ).toBe('FY2026');
  });
});

// ---------------------------------------------------------------- 다음 실적 일정
describe('nextEarnings', () => {
  it('미래 일정이 있으면 확정', () => {
    expect(nextEarnings([{ period: '2026-Q3', event_date: '2026-10-29' }], '2026-10-01')).toEqual({
      period: '2026-Q3',
      date: '2026-10-29',
      estimated: false,
    });
  });
  it('없으면 작년 같은 분기 + 1년 = 추정', () => {
    expect(
      nextEarnings(
        [
          { period: '2025-Q4', event_date: '2026-02-12' },
          { period: '2026-Q3', event_date: '2026-10-29' },
        ],
        '2026-11-09'
      )
    ).toEqual({ period: '2026-Q4', date: '2027-02-12', estimated: true });
  });
  it('작년 같은 분기가 연간(FY) 발표여도 추정한다', () => {
    expect(
      nextEarnings(
        [
          { period: '2025-FY', event_date: '2026-02-26' },
          { period: '2026-Q3', event_date: '2026-10-28' },
        ],
        '2026-11-10'
      )
    ).toEqual({ period: '2026-Q4', date: '2027-02-26', estimated: true });
  });
  it('추정일이 이미 지났으면(수집이 밀림) 「다음 일정」으로 내지 않는다', () => {
    expect(
      nextEarnings(
        [
          { period: '2025-Q3', event_date: '2025-10-29' },
          { period: '2026-Q2', event_date: '2026-07-28' },
        ],
        '2026-11-09'
      )
    ).toBeNull();
  });
});

// ---------------------------------------------------------------- 물량 계열
describe('buildVolumeSeries', () => {
  it('(metric, region) 별로 월·분기(누계 차이 포함)·연간을 나누고 최신 정의를 붙인다', () => {
    const v = (
      period_grain: VolumeRow['period_grain'],
      period: string,
      value: number,
      published_at: string,
      definition = 'old'
    ): VolumeRow => ({
      metric: 'deliveries',
      region: 'total',
      period_grain,
      period,
      value,
      definition,
      published_at,
    });
    const out = buildVolumeSeries([
      v('quarter', '2026-Q1', 60, '2026-04-20'),
      v('ytd', '2026-6M', 130, '2026-07-20', 'new'),
      v('year', '2025', 400, '2026-01-20'),
      { ...v('month', '2026-04', 20, '2026-05-02'), region: 'vietnam' },
    ]);
    expect(out.map((s) => `${s.metric}|${s.region}`)).toEqual([
      'deliveries|total',
      'deliveries|vietnam',
    ]);
    expect(out[0].definition).toBe('new');
    expect(out[0].quarterly).toEqual([
      { period: '2026-Q1', value: 60, derived: false },
      { period: '2026-Q2', value: 70, derived: true },
    ]);
    expect(out[0].annual).toEqual([{ period: '2025', value: 400 }]);
    expect(out[1].monthly).toEqual([{ period: '2026-04', value: 20 }]);
  });
});

describe('regionQuarterCharts', () => {
  const s = (region: string, quarterly: { period: string; value: number }[]): VolumeSeries => ({
    metric: 'deliveries',
    region,
    definition: 'd',
    monthly: [],
    quarterly: quarterly.map((q) => ({ ...q, derived: false })),
    annual: [],
  });
  it('중국 계열만 분기 막대 점으로 — 전체·다른 지역(북미)은 차트를 만들지 않는다', () => {
    const out = regionQuarterCharts([
      s('total', [{ period: '2026-Q1', value: 900 }]),
      s('north_america', [{ period: '2026-Q1', value: 200 }]),
      s('china', [
        { period: '2025-Q1', value: 400 },
        { period: '2026-Q1', value: 300 },
      ]),
    ]);
    expect(out.map((c) => c.region)).toEqual(['china']);
    expect(out[0].points).toEqual([
      { period: '2025-Q1', period_label: '2025Q1', sales: 400, yoy_pct: null },
      { period: '2026-Q1', period_label: '2026Q1', sales: 300, yoy_pct: -25 },
    ]);
  });
  it('중국 분기 값이 없으면(월·연간만) 차트도 없다', () => {
    expect(regionQuarterCharts([s('china', [])])).toEqual([]);
  });
});

describe('latestChinaJv', () => {
  const jv = (period: string, value: number) => row(period, CHINA_JV_METRIC, 'reported', value);
  it('가장 최근 기간(같은 해면 1분기 < 상반기 < 9개월 < 연간) + 전년 같은 기간', () => {
    const out = latestChinaJv([
      jv('2025-9M', 744),
      jv('2026-Q1', 50),
      jv('2026-6M', 184),
      jv('2026-9M', -113),
      row('2026-9M', 'revenue', 'reported', 1000),
    ]);
    expect(out?.latest.period).toBe('2026-9M');
    expect(out?.latest.value).toBe(-113);
    expect(out?.prior?.value).toBe(744);
  });
  it('전년 같은 기간이 없으면 prior = null · 합작사 행이 없으면 null', () => {
    expect(latestChinaJv([jv('2026-6M', 184)])?.prior).toBeNull();
    expect(latestChinaJv([row('2026-9M', 'revenue', 'reported', 1000)])).toBeNull();
  });
});

// ---------------------------------------------------------------- pickEarnings(선택 7차)
const pt = (
  y: number,
  q: number,
  rev: number | null,
  op: number | null,
  net: number | null
): CustomerEarningsPoint => ({
  period_label: `${y}Q${q}`,
  fiscal_year: y,
  fiscal_quarter: q,
  revenue_bn: rev,
  operating_income_bn: op,
  operating_margin_pct: rev && op != null ? (op / rev) * 100 : null,
  net_income_bn: net,
  revenue_yoy_pct: null,
});
const earn = (quarterly: CustomerEarningsPoint[]): CustomerEarnings => ({
  currency: 'EUR',
  quarterly,
  annual: [],
});
const row = (
  period: string,
  metric: string,
  basis: 'reported' | 'adjusted',
  value: number,
  extra: Partial<ReportedRow> = {}
): ReportedRow => ({
  period_grain: period.endsWith('M') ? 'ytd' : /-Q\d$/.test(period) ? 'quarter' : 'year',
  period,
  metric,
  metric_name: metric === 'aoi' ? 'Adjusted operating income/(loss)' : metric,
  basis,
  value,
  unit: 'million',
  currency: 'EUR',
  ...extra,
});

describe('pickEarnings', () => {
  it('회사 장부상 값이 있으면 시장 값보다 우선(값이 달라도) · 영업이익률도 회사 값으로', () => {
    const out = pickEarnings(earn([pt(2025, 1, 35.8, 5.4, 4.0)]), [
      row('2025-Q1', 'revenue', 'reported', 35813),
      row('2025-Q1', 'operating_income', 'reported', -316),
      row('2025-Q1', 'net_income', 'reported', -387),
    ]);
    const p = out.quarterly[0];
    expect(p.operating_income_bn).toBeCloseTo(-0.316);
    expect(p.net_income_bn).toBeCloseTo(-0.387);
    expect(p.operating_margin_pct).toBeCloseTo((-316 / 35813) * 100);
    expect(p.origin).toEqual({
      revenue: { source: 'company_reported' },
      operating_income: { source: 'company_reported' },
      net_income: { source: 'company_reported', definition: 'total' },
    });
  });

  it('장부상이 없으면 회사 조정 영업이익 · 회사가 쓴 이름을 내려 준다', () => {
    const p = pickEarnings(earn([pt(2025, 1, 35.8, 5.4, null)]), [
      row('2025-Q1', 'aoi', 'adjusted', 327),
    ]).quarterly[0];
    expect(p.operating_income_bn).toBeCloseTo(0.327);
    expect(p.origin?.operating_income).toEqual({
      source: 'company_adjusted',
      metric_name: 'Adjusted operating income/(loss)',
    });
    expect(p.adjusted).toEqual([
      { metric: 'aoi', name: 'Adjusted operating income/(loss)', value_bn: 0.327 },
    ]);
    expect(p.origin?.revenue).toEqual({ source: 'market' });
  });

  it('회사가 그 분기 이익을 어디에도 안 냈을 때만 시장 값 + 같은 해 회사 누계(각주 재료)', () => {
    const p = pickEarnings(earn([pt(2025, 1, 35.8, 1.1, 0.9)]), [
      row('2025-6M', 'operating_income', 'reported', -2710),
      row('2025-6M', 'aoi', 'adjusted', 540),
    ]).quarterly[0];
    expect(p.operating_income_bn).toBeCloseTo(1.1);
    expect(p.origin?.operating_income).toEqual({
      source: 'market',
      company_cumulative: [
        { period: '2025-6M', metric_name: 'operating_income', basis: 'reported', value_bn: -2.71 },
        {
          period: '2025-6M',
          metric_name: 'Adjusted operating income/(loss)',
          basis: 'adjusted',
          value_bn: 0.54,
        },
      ],
    });
  });

  it('누계 차이로 만든 회사 분기는 시장 값보다 우선이고 derived 를 표시한다', () => {
    const p = pickEarnings(earn([pt(2025, 1, 35.8, 1.1, null), pt(2025, 2, 38.4, 2.0, null)]), [
      row('2025-Q1', 'operating_income', 'reported', -316),
      row('2025-6M', 'operating_income', 'reported', -2710),
    ]).quarterly[1];
    expect(p.operating_income_bn).toBeCloseTo(-2.394);
    expect(p.origin?.operating_income).toEqual({ source: 'company_reported', derived: true });
  });

  it('어디에도 없으면 none(「미발표」) · financials 에 없는 분기는 회사 값으로 점을 만든다', () => {
    const out = pickEarnings(earn([pt(2025, 1, 35.8, null, null)]), [
      row('2025-Q2', 'revenue', 'reported', 38448),
    ]);
    expect(out.quarterly[0].origin?.operating_income).toEqual({ source: 'none' });
    expect(out.quarterly[0].operating_income_bn).toBeNull();
    expect(out.quarterly.map((p) => p.period_label)).toEqual(['2025Q1', '2025Q2']);
    expect(out.quarterly[1].revenue_bn).toBeCloseTo(38.448);
  });

  it('회사 값이 뒤늦게 적재되면 같은 입력의 그 칸이 시장 → 회사로 바뀐다(소급 공표)', () => {
    const fin = earn([pt(2025, 3, 37.2, 2.6, 1.9)]);
    expect(pickEarnings(fin, []).quarterly[0].origin?.operating_income.source).toBe('market');
    const after = pickEarnings(fin, [row('2025-Q3', 'operating_income', 'reported', -2455)])
      .quarterly[0];
    expect(after.origin?.operating_income.source).toBe('company_reported');
    expect(after.operating_income_bn).toBeCloseTo(-2.455);
    expect(fin.quarterly[0].operating_income_bn).toBe(2.6); // 입력(= DB 의 yfinance 값)은 건드리지 않는다
  });

  it('통화가 다른 회사 행·주당 값은 쓰지 않는다', () => {
    const p = pickEarnings(earn([pt(2025, 1, 35.8, 1.1, null)]), [
      row('2025-Q1', 'operating_income', 'reported', 999, { currency: 'USD' }),
      row('2025-Q1', 'eps_adjusted', 'adjusted', 1.2, { unit: 'per_share' }),
    ]).quarterly[0];
    expect(p.origin?.operating_income.source).toBe('market');
    expect(p.adjusted).toBeUndefined();
  });

  it('매출 출처가 회사면 전년 대비를 고른 값으로 다시 잰다', () => {
    const out = pickEarnings(earn([pt(2024, 1, 40, null, null), pt(2025, 1, null, null, null)]), [
      row('2025-Q1', 'revenue', 'reported', 44000),
    ]);
    expect(out.quarterly[1].revenue_yoy_pct).toBeCloseTo(10);
  });

  // ---- 원장 carry 반례(태스크 7·10)
  it('누계에서 분기를 뺄 때 단위를 먼저 맞춘다(1분기 million · 반기·9M billion)', () => {
    const p = pickEarnings(earn([]), [
      row('2026-Q1', 'operating_income', 'reported', 595),
      row('2026-6M', 'operating_income', 'reported', 1.35, { unit: 'billion' }),
      row('2026-9M', 'operating_income', 'reported', 1.9, { unit: 'billion' }),
    ]).quarterly;
    expect(p.map((x) => x.period_label)).toEqual(['2026Q1', '2026Q2', '2026Q3']);
    expect(p[0].operating_income_bn).toBeCloseTo(0.595);
    expect(p[1].operating_income_bn).toBeCloseTo(0.755);
    expect(p[2].operating_income_bn).toBeCloseTo(0.55);
    expect(p[1].origin?.operating_income).toEqual({ source: 'company_reported', derived: true });
  });

  it('별도 기준 행(metric_name 「(별도)」)은 연결 칸을 대신하지 않는다', () => {
    const p = pickEarnings(earn([pt(2025, 1, 3.0, 0.1, 0.05), pt(2025, 2, 3.2, 0.12, 0.06)]), [
      row('2025-Q1', 'revenue', 'reported', 2900, {
        metric_name: '매출액 (별도)',
        currency: 'EUR',
      }),
      row('2025-Q1', 'operating_income', 'reported', 80, { metric_name: '영업이익 (별도)' }),
      row('2025-6M', 'operating_income', 'reported', 170, { metric_name: '영업이익(별도)' }),
    ]).quarterly;
    expect(p[0].revenue_bn).toBe(3.0);
    expect(p[0].origin?.revenue.source).toBe('market');
    expect(p[0].origin?.operating_income.source).toBe('market');
    expect(p[1].origin?.operating_income.source).toBe('market'); // 별도 누계 차이도 만들지 않는다
    expect(p[0].origin?.operating_income.company_cumulative).toBeUndefined();
  });

  it('순이익 출처가 바뀌면 정의 라벨도 바뀐다(회사 = 세후 합계 · 시장 = 주주 귀속)', () => {
    const out = pickEarnings(earn([pt(2025, 2, 30, 1, 0.8), pt(2025, 3, 31, 1, 0.9)]), [
      row('2025-Q3', 'net_income', 'reported', 950),
    ]).quarterly;
    expect(out[0].origin?.net_income).toEqual({ source: 'market', definition: 'parent' });
    expect(out[1].origin?.net_income).toEqual({ source: 'company_reported', definition: 'total' });
  });

  it('회사가 지배주주 귀속 순이익만 내면 그 값이 시장 값보다 우선(정의 parent) · 세후 합계가 있으면 합계가 먼저', () => {
    const out = pickEarnings(earn([pt(2025, 1, 30, 1, 0.8), pt(2025, 2, 31, 1, 0.9)]), [
      row('2025-Q1', 'net_income_parent', 'reported', 610),
      row('2025-Q2', 'net_income_parent', 'reported', 700),
      row('2025-Q2', 'net_income', 'reported', 720),
    ]).quarterly;
    expect(out[0].net_income_bn).toBeCloseTo(0.61);
    expect(out[0].origin?.net_income).toEqual({ source: 'company_reported', definition: 'parent' });
    expect(out[1].net_income_bn).toBeCloseTo(0.72);
    expect(out[1].origin?.net_income).toEqual({ source: 'company_reported', definition: 'total' });
  });
});

describe('droppedCurrencies', () => {
  it('실적 통화와 다른 회사 행의 통화만(주당 값·별도 행 제외) — 같으면 빈 배열', () => {
    const fin = earn([pt(2025, 1, 30, 1, 1)]);
    expect(
      droppedCurrencies(fin, [
        row('2025-Q1', 'revenue', 'reported', 1, { currency: 'USD' }),
        row('2025-Q2', 'revenue', 'reported', 1, { currency: 'USD' }),
        row('2025-Q1', 'eps_adjusted', 'adjusted', 1, { currency: 'VND', unit: 'per_share' }),
        row('2025-Q1', 'operating_income', 'reported', 1),
      ])
    ).toEqual(['USD']);
    expect(droppedCurrencies(fin, [row('2025-Q1', 'revenue', 'reported', 1)])).toEqual([]);
  });
});
