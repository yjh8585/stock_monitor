// 고객사 화면 표시 함수 시험 — 가짜 회사 Acme Motors · 숫자는 임의.
import { describe, expect, it } from 'vitest';
import {
  amountText,
  approxPrefix,
  docTypeLabel,
  earningsFootnotes,
  guidanceDirection,
  latestActual,
  mergeGuidanceChains,
  originNote,
  pctText,
  periodText,
  rangeText,
  seoulDate,
  toUnit,
  volumeSeriesLabel,
} from './format';
import type { GuidanceCard, GuidanceRowTs, ReportedRow } from './ir';
import type { CustomerEarningsPoint } from './types';

describe('pctText', () => {
  it('기존 동작 유지', () => {
    expect(pctText(1.234)).toBe('+1.2%');
    expect(pctText(null)).toBe('—');
  });
});

describe('approxPrefix', () => {
  it('원문 구절이 근사 낱말로 시작하면 「약 」 — 전망을 단정으로 바꾸지 않는다', () => {
    expect(approxPrefix('around €315 billion')).toBe('약 ');
    expect(approxPrefix('Around 315 billion')).toBe('약 ');
    expect(approxPrefix('approximately 6 percent')).toBe('약 ');
    expect(approxPrefix('about $2 billion')).toBe('약 ');
    expect(approxPrefix('약 3조원')).toBe('약 ');
  });
  it('근사 낱말이 아니거나 원문 구절이 없으면 빈 문자열(다른 행 표시는 그대로)', () => {
    expect(approxPrefix(null)).toBe('');
    expect(approxPrefix('€(5) billion - €(10) billion')).toBe('');
    expect(approxPrefix('aboutness 3')).toBe('');
    expect(approxPrefix('in line with the previous year')).toBe('');
  });
});

describe('rangeText · amountText', () => {
  it('금액 범위 = 숫자~숫자 + 단위 + 통화 이름', () => {
    expect(rangeText(14.5, 15.5, 'billion', 'USD')).toBe('14.5~15.5 십억 달러');
    expect(rangeText(-10, -5, 'billion', 'EUR')).toBe('-10~-5 십억 유로');
  });
  it('하한·상한이 같으면 한 값', () => {
    expect(rangeText(8970, 8970, 'million', 'USD')).toBe('8,970 백만 달러');
  });
  it('한쪽만 있으면 이상·이하', () => {
    expect(rangeText(300000, null, 'units', null)).toBe('300,000대 이상');
    expect(rangeText(null, 1, 'percent', null)).toBe('1% 이하');
  });
  it('퍼센트·주당·통화 없음', () => {
    expect(rangeText(4, 5.5, 'percent', null)).toBe('4~5.5%');
    expect(rangeText(12.75, 13.75, 'per_share', 'USD')).toBe('12.75~13.75 달러/주');
    expect(rangeText(1, 2, 'billion', null)).toBe('1~2 십억');
  });
  it('모르는 통화는 코드 그대로 · 둘 다 없으면 —', () => {
    expect(amountText(2.5, 'billion', 'CHF')).toBe('2.5 십억 CHF');
    expect(rangeText(null, null, 'billion', 'USD')).toBe('—');
    expect(amountText(null, 'billion', 'USD')).toBe('—');
  });
  it('조 단위', () => {
    expect(rangeText(122.3, 122.3, 'trillion', 'KRW')).toBe('122.3 조 원');
  });
});

describe('toUnit', () => {
  it('백만 → 십억·조', () => {
    expect(toUnit(4106, 'million', 'billion')).toEqual({ value: 4.106, unit: 'billion' });
    expect(toUnit(31_597_447, 'million', 'trillion').value).toBeCloseTo(31.597447);
  });
  it('금액 규모 단위가 아니면 그대로', () => {
    expect(toUnit(3.7, 'per_share', 'per_share')).toEqual({ value: 3.7, unit: 'per_share' });
    expect(toUnit(8, 'million', 'percent')).toEqual({ value: 8, unit: 'million' });
  });
});

describe('originNote', () => {
  it('회사 장부상은 각주 없음', () => {
    expect(originNote({ source: 'company_reported' }, 'EUR')).toBeNull();
    expect(originNote(undefined, 'EUR')).toBeNull();
  });
  it('조정 영업이익 = 회사 이름 그대로', () => {
    expect(originNote({ source: 'company_adjusted', metric_name: 'EBIT-adjusted' }, 'USD')).toBe(
      '회사 발표 조정 영업이익(EBIT-adjusted) — 장부상 미발표'
    );
  });
  it('시장 값 + 회사 누계 각주', () => {
    expect(
      originNote(
        {
          source: 'market',
          company_cumulative: [
            {
              period: '2025-6M',
              metric_name: 'Operating profit',
              basis: 'reported',
              value_bn: 1.2,
            },
            { period: '2025', metric_name: 'Operating profit', basis: 'reported', value_bn: 2.5 },
          ],
        },
        'EUR'
      )
    ).toBe(
      '회사 미발표 · 시장 데이터 추정 · 회사 발표 2025 반기 Operating profit 1.2 십억 유로 · 회사 발표 2025 연간 Operating profit 2.5 십억 유로'
    );
    expect(originNote({ source: 'market' }, 'EUR')).toBe('회사 미발표 · 시장 데이터 추정');
  });
  it('누계 차이 계산 · 없음', () => {
    expect(originNote({ source: 'company_reported', derived: true }, 'EUR')).toBe(
      '회사 발표 누계 차이로 계산'
    );
    expect(
      originNote({ source: 'company_adjusted', metric_name: 'AOI', derived: true }, 'EUR')
    ).toBe('회사 발표 조정 영업이익(AOI) — 장부상 미발표 · 회사 발표 누계 차이로 계산');
    expect(originNote({ source: 'none' }, 'EUR')).toBe('미발표');
  });
});

const pt = (label: string, over: Partial<CustomerEarningsPoint> = {}): CustomerEarningsPoint => ({
  period_label: label,
  fiscal_year: 2025,
  fiscal_quarter: 1,
  revenue_bn: 10,
  operating_income_bn: 1,
  operating_margin_pct: 10,
  net_income_bn: 0.5,
  revenue_yoy_pct: null,
  ...over,
});
const rep = { source: 'company_reported' } as const;

describe('earningsFootnotes', () => {
  it('같은 문장은 번호 하나 · 장부상 칸은 표시 없음', () => {
    const fn = earningsFootnotes(
      [
        pt('2025Q1', {
          origin: { revenue: rep, operating_income: { source: 'none' }, net_income: rep },
        }),
        pt('2025Q2', {
          origin: { revenue: rep, operating_income: { source: 'none' }, net_income: rep },
        }),
      ],
      'EUR'
    );
    expect(fn.notes).toEqual(['미발표']);
    expect(fn.marks).toEqual({ '2025Q1|operating_income': [1], '2025Q2|operating_income': [1] });
  });
  it('origin 없는 점(국내)은 빈 각주', () => {
    expect(earningsFootnotes([pt('2025Q1')], 'KRW')).toEqual({ notes: [], marks: {} });
  });
  it('순이익 정의가 섞일 때만 정의 각주', () => {
    const mixed = earningsFootnotes(
      [
        pt('2025Q1', {
          origin: {
            revenue: rep,
            operating_income: rep,
            net_income: { source: 'company_reported', definition: 'total' },
          },
        }),
        pt('2025Q2', {
          origin: {
            revenue: rep,
            operating_income: rep,
            net_income: { source: 'market', definition: 'parent' },
          },
        }),
      ],
      'EUR'
    );
    expect(mixed.notes).toEqual([
      '순이익 = 세후 합계(비지배지분 포함)',
      '회사 미발표 · 시장 데이터 추정',
      '순이익 = 지배주주 귀속',
    ]);
    expect(mixed.marks['2025Q2|net_income']).toEqual([2, 3]);
    const same = earningsFootnotes(
      [
        pt('2025Q1', {
          origin: {
            revenue: rep,
            operating_income: rep,
            net_income: { source: 'company_reported', definition: 'total' },
          },
        }),
      ],
      'EUR'
    );
    expect(same.notes).toEqual([]);
  });
});

const g = (over: Partial<GuidanceRowTs>): GuidanceRowTs => ({
  metric: 'revenue_growth',
  metric_label: 'Sales growth',
  period: 'FY2026',
  low: 0,
  high: 3,
  value_text: null,
  unit: 'percent',
  basis: 'reported',
  currency: null,
  stated: null,
  direction: 'initiated',
  extractor: 'code',
  quote: 'q',
  published_at: '2026-03-10',
  verified: true,
  ...over,
});
const card = (rows: GuidanceRowTs[], withdrawn_at: string | null = null): GuidanceCard => ({
  period: rows[0].period,
  current: rows.at(-1)!,
  history: rows,
  withdrawn_at,
  metric: rows[0].metric,
  currency: 'EUR',
  longer_term: [],
});

describe('guidanceDirection', () => {
  const withdrawn = g({
    metric: 'other',
    period: 'FY2025',
    stated: 'withdrawn',
    direction: 'withdrawn',
    published_at: '2025-04-29',
  });
  it('상향·하향·유지·최초', () => {
    expect(guidanceDirection(g({ direction: 'raised' }), []).label).toBe('상향');
    expect(guidanceDirection(g({ direction: 'lowered' }), []).tone).toBe('down');
    expect(guidanceDirection(g({ direction: 'maintained' }), []).tone).toBe('flat');
    expect(guidanceDirection(g({}), []).label).toBe('최초');
  });
  it('같은 FY 철회 뒤의 최초는 재개', () => {
    const again = g({ period: 'FY2025', published_at: '2025-10-28' });
    expect(guidanceDirection(again, [withdrawn]).label).toBe('재개');
    // 다른 FY · 철회보다 앞선 최초는 그대로
    expect(guidanceDirection(g({ published_at: '2025-10-28' }), [withdrawn]).label).toBe('최초');
    expect(
      guidanceDirection(g({ period: 'FY2025', published_at: '2025-01-28' }), [withdrawn]).label
    ).toBe('최초');
  });
  // 전망 지표가 바뀐 사슬(성장률 % → 매출 금액)의 뒤쪽 지표 첫 행 — 수집기는 새 지표라 initiated 로 찍는다
  it('사슬 뒤쪽 지표의 첫 행은 「최초」 대신 「기준 변경」 · 행의 stated 를 함께', () => {
    expect(guidanceDirection(g({}), [], { chainStart: true }).label).toBe('기준 변경');
    expect(guidanceDirection(g({ stated: 'raised' }), [], { chainStart: true }).label).toBe(
      '기준 변경 · 상향'
    );
    expect(guidanceDirection(g({ stated: 'maintained' }), [], { chainStart: true }).label).toBe(
      '기준 변경 · 유지 확인'
    );
    // 사슬 첫 행이 아니면 그대로 최초 · initiated 가 아니면 숫자 방향 그대로
    expect(guidanceDirection(g({ stated: 'raised' }), []).label).toBe('최초');
    expect(guidanceDirection(g({ direction: 'raised' }), [], { chainStart: true }).label).toBe(
      '상향'
    );
  });
  it('철회 뒤 재개는 기준 변경보다 앞선다', () => {
    const again = g({ period: 'FY2025', published_at: '2025-10-28' });
    expect(guidanceDirection(again, [withdrawn], { chainStart: true }).label).toBe('재개');
  });
});

describe('seoulDate', () => {
  it('UTC 시각을 서울 날짜로 — UTC 15시 이후는 다음 날', () => {
    expect(seoulDate('2026-11-09T20:05:00+00:00')).toBe('2026-11-10');
    expect(seoulDate('2026-11-09T14:59:59.123+00:00')).toBe('2026-11-09');
  });
});

describe('mergeGuidanceChains', () => {
  it('같은 FY 매출 계열이 지표를 바꿔 이어지면 한 카드로 묶는다', () => {
    const growth = card([
      g({ published_at: '2026-03-10' }),
      g({ direction: 'lowered', low: -3, high: 0, published_at: '2026-07-24' }),
    ]);
    const revenue = card([
      g({
        metric: 'revenue',
        metric_label: 'Group sales revenue',
        low: 315,
        high: 315,
        unit: 'billion',
        published_at: '2026-09-18',
      }),
    ]);
    const other = card([g({ metric: 'operating_margin', published_at: '2026-03-10' })]);
    const views = mergeGuidanceChains([growth, revenue, other]);
    expect(views).toHaveLength(2);
    const chain = views.find((v) => v.card.metric === 'revenue')!;
    expect(chain.predecessors.map((c) => c.metric)).toEqual(['revenue_growth']);
  });
  it('기간이 겹치면(둘 다 갱신 중) 따로 둔다', () => {
    const a = card([g({ published_at: '2026-03-10' }), g({ published_at: '2026-10-01' })]);
    const b = card([g({ metric: 'revenue', published_at: '2026-09-18' })]);
    expect(mergeGuidanceChains([a, b])).toHaveLength(2);
  });
  it('FY 가 다르면 묶지 않는다', () => {
    const a = card([g({ period: 'FY2025', published_at: '2025-03-10' })]);
    const b = card([g({ metric: 'revenue', period: 'FY2026', published_at: '2026-09-18' })]);
    expect(mergeGuidanceChains([a, b])).toHaveLength(2);
  });
});

const r = (over: Partial<ReportedRow>): ReportedRow => ({
  period_grain: 'quarter',
  period: '2026-Q3',
  metric: 'ebit_adjusted',
  metric_name: 'EBIT-adjusted',
  basis: 'adjusted',
  value: 3000,
  unit: 'million',
  currency: 'USD',
  ...over,
});

describe('latestActual', () => {
  it('가장 늦은 기간 · 같은 끝이면 누계 우선', () => {
    const got = latestActual(
      [
        r({ period: '2026-Q2' }),
        r({ period: '2026-Q3' }),
        r({ period_grain: 'ytd', period: '2026-9M', value: 9000 }),
      ],
      'ebit_adjusted',
      'USD'
    );
    expect(got?.period).toBe('2026-9M');
  });
  it('별도 기준·다른 통화·다른 지표는 뺀다', () => {
    expect(
      latestActual(
        [
          r({ metric_name: '영업이익 (별도)', period: '2026-Q3' }),
          r({ currency: 'EUR' }),
          r({ metric: 'revenue' }),
        ],
        'ebit_adjusted',
        'USD'
      )
    ).toBeNull();
  });
});

describe('라벨', () => {
  it('기간', () => {
    expect(periodText('2026-Q3')).toBe('2026년 3분기');
    expect(periodText('2026-FY')).toBe('2026년 연간(4분기)');
    expect(periodText('2026-9M')).toBe('2026년 9개월 누계');
    expect(periodText('2026-6M')).toBe('2026년 반기');
    expect(periodText('2026')).toBe('2026년 연간');
  });
  it('문서 종류·물량 계열 — 모르는 값은 그대로', () => {
    expect(docTypeLabel('earnings_release')).toBe('실적 발표');
    expect(docTypeLabel('mystery')).toBe('mystery');
    expect(volumeSeriesLabel('deliveries', 'total')).toBe('인도');
    expect(volumeSeriesLabel('wholesale', 'north_america')).toBe('도매 판매 · 북미');
    expect(volumeSeriesLabel('x', 'y')).toBe('x · y');
  });
});
