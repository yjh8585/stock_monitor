import { describe, expect, it } from 'vitest';
import {
  breakdownPeriodLabel,
  buildBreakdown,
  dropSubLabels,
  periodSortKey,
  pickGrain,
  type BreakdownRow,
} from './breakdown';

// 가짜 회사 — 사외비 이름을 시험에 쓰지 않는다.
const row = (o: Partial<BreakdownRow>): BreakdownRow => ({
  document_id: 1,
  page: 3,
  kind: 'region',
  metric: 'deliveries',
  label_raw: 'North America',
  label_ko: '북미',
  period_grain: 'quarter',
  period: '2026-Q1',
  value: 100_000,
  unit: 'units',
  definition: null,
  published_at: '2026-05-01',
  doc_title: 'Acme Motors Q1 2026',
  doc_url: 'https://example.com/q1.pdf',
  ...o,
});

describe('기간 — 정렬 열쇠·짧은 이름', () => {
  it('누계 9M 이 12M 보다 앞(글자순이면 뒤집힌다)', () => {
    expect(periodSortKey('ytd', '2026-9M') < periodSortKey('ytd', '2026-12M')).toBe(true);
  });
  it('분기·반기·누계·월·시점 이름', () => {
    expect(breakdownPeriodLabel('quarter', '2026-Q3')).toBe('26Q3');
    expect(breakdownPeriodLabel('half', '2026-H1')).toBe('26H1');
    expect(breakdownPeriodLabel('ytd', '2026-9M')).toBe('26 1~9월');
    expect(breakdownPeriodLabel('month', '2026-10')).toBe('26.10');
    expect(breakdownPeriodLabel('asof', '2026-09-30')).toBe('26.09.30');
    expect(breakdownPeriodLabel('year', '2025')).toBe('2025');
  });
});

describe('pickGrain', () => {
  const m = (o: Record<string, string[]>) =>
    new Map(Object.entries(o).map(([g, ps]) => [g as never, new Set(ps)]));
  it('분기 2개 이상 → 분기', () => {
    expect(pickGrain(m({ quarter: ['2026-Q1', '2026-Q2'], year: ['2025'] }))).toBe('quarter');
  });
  it('분기 1개면 연간', () => {
    expect(pickGrain(m({ quarter: ['2026-Q1'], year: ['2025'] }))).toBe('year');
  });
  it('같은 분기 번호 둘(25Q1·26Q1)은 흐름이 아니다 → 연간', () => {
    expect(pickGrain(m({ quarter: ['2025-Q1', '2026-Q1'], year: ['2025'] }))).toBe('year');
  });
  it('둘 다 없으면 기간이 가장 많은 꼴', () => {
    expect(pickGrain(m({ ytd: ['2025-9M', '2026-9M'], half: ['2026-H1'] }))).toBe('ytd');
  });
});

describe('dropSubLabels — 상위 라벨이 있으면 하위를 뺀다', () => {
  it('「Model X」 가 있으면 「Model X BEV」 를 뺀다 · 상위가 없으면 둔다', () => {
    const rs = (
      [
        ['Model X', 100_000],
        ['Model X BEV', 60_000],
        ['Model X ICE', 40_000],
        ['Model Y BEV', 30_000],
      ] as const
    ).map(([l, v]) => row({ label_raw: l, value: v }));
    expect(dropSubLabels(rs).map((r) => r.label_raw)).toEqual(['Model X', 'Model Y BEV']);
  });

  it('이름만 겹치는 형제(하위 합이 상위보다 크다)는 남긴다', () => {
    const rs = [
      row({ label_raw: 'VF 8', value: 5_000 }),
      row({ label_raw: 'VF 8 Plus', value: 7_000 }),
    ];
    expect(dropSubLabels(rs).map((r) => r.label_raw)).toEqual(['VF 8', 'VF 8 Plus']);
  });
});

describe('buildBreakdown', () => {
  it('값이 없는 탭은 빠지고 순서는 지역 → 차종 → 점유율', () => {
    const tabs = buildBreakdown([
      row({ kind: 'share', metric: 'market_share', unit: 'share_pct', value: 7.5 }),
      row({}),
    ]);
    expect(tabs.map((t) => t.kind)).toEqual(['region', 'share']);
  });

  it('대수는 천대 차트 · 기간 오름차순 · 합계', () => {
    const [tab] = buildBreakdown([
      row({ period: '2026-Q2', value: 120_000 }),
      row({ period: '2026-Q2', label_raw: 'Europe', label_ko: '유럽', value: 80_500 }),
      row({ period: '2026-Q1', value: 100_000 }),
    ]);
    const c = tab.charts[0];
    expect(c.unit).toEqual({ label: '천대', tick: 'thousand_units' });
    // 연간 값이 없고 26Q2 에 유럽이 새로 생겨 1~6월 합은 못 만든다 → 이름이 같은 1~3월까지로 물러선다.
    expect(c.views.map((v) => v.label)).toEqual(['분기', '연간']);
    expect(c.views[1].data.map((p) => [p.period_label, p.total])).toEqual([['26 1~3월', 100]]);
    const data = c.views[0].data;
    expect(data.map((p) => p.period_label)).toEqual(['26Q1', '26Q2']);
    expect(data[1].regions).toEqual({ 북미: 120, 유럽: 80.5 });
    expect(data[1].total).toBe(200.5);
    expect(tab.tables).toEqual([]);
  });

  it('차트는 한 기간 = 한 문서 — 이름 체계가 다른 두 문서를 쌓지 않는다', () => {
    const [tab] = buildBreakdown([
      // 문서 1(팩트시트): 구분 3개 — 고른다
      row({
        document_id: 1,
        kind: 'model',
        label_raw: 'Model X',
        label_ko: '모델 X',
        value: 10_000,
      }),
      row({
        document_id: 1,
        kind: 'model',
        label_raw: 'Model X BEV',
        label_ko: '모델 X BEV',
        value: 4_000,
      }),
      row({
        document_id: 1,
        kind: 'model',
        label_raw: 'Model Z',
        label_ko: '모델 Z',
        value: 5_000,
      }),
      row({
        document_id: 1,
        kind: 'model',
        label_raw: 'Model W',
        label_ko: '모델 W',
        value: 1_000,
      }),
      // 문서 2(발표자료 · 더 최신): 구분 2개, 다른 표기
      row({
        document_id: 2,
        kind: 'model',
        label_raw: 'Model X (Combustion)',
        label_ko: '모델 X 내연',
        value: 6_000,
        published_at: '2026-06-01',
      }),
      row({
        document_id: 2,
        kind: 'model',
        label_raw: 'Model Z',
        label_ko: '모델 Z',
        value: 5_000,
        published_at: '2026-06-01',
      }),
      row({
        document_id: 1,
        kind: 'model',
        period: '2026-Q2',
        label_raw: 'Model Z',
        label_ko: '모델 Z',
        value: 5_500,
      }),
    ]);
    const q1 = tab.charts[0].views[0].data[0];
    expect(q1.regions).toEqual({ '모델 X': 10, '모델 Z': 5, '모델 W': 1 }); // 하위(BEV)도 빠진다
  });

  it('구성비·점유율은 표 — 칸마다 최신 공시 · 고른 꼴 + 연간', () => {
    const share = (o: Partial<BreakdownRow>) =>
      row({ kind: 'share', metric: 'market_share', unit: 'share_pct', ...o });
    const [tab] = buildBreakdown([
      share({ period: '2026-Q1', value: 7.1 }),
      share({ period: '2026-Q2', value: 7.4 }),
      share({
        period_grain: 'year',
        period: '2025',
        value: 6.9,
        document_id: 5,
        published_at: '2026-01-30',
      }),
      share({
        period_grain: 'year',
        period: '2025',
        value: 6.8,
        document_id: 6,
        published_at: '2026-04-30',
      }),
      share({ period: '2026-Q2', label_raw: 'Europe', label_ko: '유럽', value: 3.4 }),
    ]);
    expect(tab.charts).toEqual([]);
    expect(tab.tables.map((t) => t.title)).toEqual(['시장 점유율 (분기)', '시장 점유율 (연간)']);
    const [q, y] = tab.tables;
    expect(q.columns.map((c) => c.label)).toEqual(['26Q1', '26Q2']);
    expect(q.rows).toEqual([
      { label: '북미', values: [7.1, 7.4], yoy: [null, null] },
      { label: '유럽', values: [null, 3.4], yoy: [null, null] },
    ]);
    expect(y.rows).toEqual([{ label: '북미', values: [6.8], yoy: [null] }]); // 최신 공시가 이긴다
  });

  it('sales 는 단위로 판매/매출을 가른다 · 외화는 백만', () => {
    const [tab] = buildBreakdown([
      row({ metric: 'sales', unit: 'USD', value: 1_815_000_000 }),
      row({ metric: 'sales', unit: 'USD', period: '2026-Q2', value: 1_900_000_000 }),
    ]);
    expect(tab.charts[0].title).toBe('매출 (백만 USD)');
    expect(tab.charts[0].views[0].data[0].regions).toEqual({ 북미: 1815 });
  });

  it('하위 구분(_detail)은 상위와 다른 차트 「(세분)」 — 북미 합계와 미국을 한 차트에 쌓지 않는다', () => {
    const [tab] = buildBreakdown([
      row({ value: 300_000 }),
      row({
        metric: 'deliveries_detail',
        label_raw: 'United States',
        label_ko: '미국',
        value: 250_000,
      }),
      row({
        metric: 'deliveries_detail',
        label_raw: 'Other',
        label_ko: '기타 북미',
        value: 50_000,
      }),
    ]);
    expect(tab.charts.map((c) => c.title.split(' (')[0])).toEqual(['인도', '인도(세분)']);
    expect(tab.charts[0].views[0].data[0].total).toBe(300);
    expect(tab.charts[1].views[0].data[0].regions).toEqual({ 미국: 250, '기타 북미': 50 });
  });

  it('합계는 반올림 전 값으로 — 50대 둘은 0.1천대', () => {
    const [tab] = buildBreakdown([
      row({ value: 50 }),
      row({ label_raw: 'Europe', label_ko: '유럽', value: 50 }),
      row({ period: '2026-Q2', value: 1_000 }),
    ]);
    expect(tab.charts[0].views[0].data[0].total).toBe(0.1);
  });

  it('문서 고르기는 하위 라벨을 뺀 뒤 — 최신 문서의 다른 구분이 사라지지 않는다', () => {
    const [tab] = buildBreakdown([
      row({ label_raw: 'Model X', label_ko: 'X', value: 100 }),
      row({ label_raw: 'Model X BEV', label_ko: 'X 전기', value: 60 }),
      row({ label_raw: 'Model X ICE', label_ko: 'X 내연', value: 40 }),
      ...['Model X', 'Model Y'].map((l) =>
        row({ document_id: 2, published_at: '2026-06-01', label_raw: l, label_ko: l.slice(-1) })
      ),
      row({ period: '2026-Q2', label_raw: 'Model X', label_ko: 'X', document_id: 3 }),
    ]);
    expect(Object.keys(tab.charts[0].views[0].data[0].regions)).toEqual(['X', 'Y']);
    // 출처 = 실제로 그린 문서만(고르지 않은 문서 1 은 빠진다) · 최신 공시부터.
    expect(tab.sources.map((s) => s.docId)).toEqual([2, 3]);
  });

  it('점유율 표 — 최신 분기 하나뿐이어도 분기 표가 남는다(연간 표와 함께)', () => {
    const [tab] = buildBreakdown([
      row({
        kind: 'share',
        metric: 'market_share',
        unit: 'share_pct',
        period_grain: 'year',
        period: '2025',
        value: 6,
      }),
      row({
        kind: 'share',
        metric: 'market_share',
        unit: 'share_pct',
        period: '2026-Q3',
        value: 8,
      }),
    ]);
    expect(tab.tables.map((t) => t.columns.map((c) => c.label))).toEqual([['2025'], ['26Q3']]);
  });

  it('뜻 상자 — 한국어 이름별 원문 표기 모음 · 최신 정의 · 출처는 최신 문서부터 쪽 번호', () => {
    const [tab] = buildBreakdown([
      row({ label_raw: 'Europe', label_ko: '유럽', definition: '옛 정의', document_id: 1 }),
      row({
        label_raw: 'Europe (excl. Home)',
        label_ko: '유럽',
        definition: '본국 제외',
        document_id: 2,
        page: 7,
        published_at: '2026-06-01',
        period: '2026-Q2',
      }),
    ]);
    expect(tab.terms).toEqual([
      { label: '유럽', raw: ['Europe', 'Europe (excl. Home)'], definition: '본국 제외' },
    ]);
    expect(tab.sources.map((s) => [s.docId, s.pages])).toEqual([
      [2, [7]],
      [1, [3]],
    ]);
  });
});

describe('올해 누계(YTD)·전년 동기 대비(YoY)', () => {
  it('1분기 보고서의 25Q1·26Q1 뿐이면 분기 차트를 고르지 않고 연간 + 회사 발표 누계', () => {
    const [tab] = buildBreakdown([
      row({ period: '2025-Q1', value: 10_000 }),
      row({ period: '2026-Q1', value: 11_000 }),
      row({ period_grain: 'year', period: '2024', value: 40_000 }),
      row({ period_grain: 'year', period: '2025', value: 44_000 }),
      row({ period_grain: 'ytd', period: '2025-9M', value: 30_000 }),
      row({ period_grain: 'ytd', period: '2026-9M', value: 36_000 }),
    ]);
    const [v] = tab.charts[0].views;
    expect(tab.charts[0].views).toHaveLength(1);
    expect(v.label).toBe('연간');
    expect(v.data.map((p) => p.period_label)).toEqual(['2024', '2025', '26 1~9월']);
    expect(v.note).toBe('26 1~9월 = 회사 발표 누계');
    expect(v.data[1].yoy).toEqual({ label: '2024', total: 10, regions: { 북미: 10 } });
    expect(v.data[2].yoy).toEqual({ label: '25 1~9월', total: 20, regions: { 북미: 20 } });
    expect(v.data[0].yoy).toBeUndefined();
  });

  it('누계 발표가 없으면 분기 합(Q1 부터) — 전년도 같은 분기까지 합과 YoY · 분기 보기도 전년 동기 YoY', () => {
    const q = (period: string, value: number) => row({ period, value });
    const [tab] = buildBreakdown([
      q('2025-Q1', 100_000),
      q('2025-Q2', 100_000),
      q('2025-Q3', 100_000),
      q('2025-Q4', 100_000),
      q('2026-Q1', 110_000),
      q('2026-Q2', 130_000),
      row({ period_grain: 'year', period: '2025', value: 400_000 }),
    ]);
    const [quarter, annual] = tab.charts[0].views;
    expect([quarter.label, annual.label]).toEqual(['분기', '연간']);
    expect(quarter.data.at(-1)!.yoy).toEqual({ label: '25Q2', total: 30, regions: { 북미: 30 } });
    expect(quarter.data[0].yoy).toBeUndefined(); // 25Q1 의 전년(24Q1)이 없다
    expect(annual.data.map((p) => [p.period_label, p.total])).toEqual([
      ['2025', 400],
      ['26 1~6월', 240],
    ]);
    expect(annual.data[1].yoy?.label).toBe('25 1~6월');
    expect(annual.data[1].yoy?.total).toBe(20);
    expect(annual.note).toBe('26 1~6월 = 발표된 분기 합');
  });

  it('구분 이름이 다른 해끼리는 합계 YoY 를 비운다(구분별 YoY 는 남는다)', () => {
    const [tab] = buildBreakdown([
      row({ period_grain: 'year', period: '2025', value: 100_000 }),
      row({
        period_grain: 'year',
        period: '2025',
        label_raw: 'Korea',
        label_ko: '한국',
        value: 80_000,
      }),
      row({ period_grain: 'year', period: '2026', value: 110_000 }),
    ]);
    expect(tab.charts[0].views[0].data[1].yoy).toEqual({
      label: '2025',
      total: null,
      regions: { 북미: 10 },
    });
  });

  it('연간 발표가 없거나 구분이 적은 해는 Q1~Q4 분기 합 · 누계 후보는 구분이 많은 쪽', () => {
    const qs = ['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'];
    const [tab] = buildBreakdown([
      ...qs.flatMap((period) => [
        row({ period, value: 10_000 }),
        row({ period, label_raw: 'Europe', label_ko: '유럽', value: 5_000 }),
      ]),
      // 연간·누계 발표는 북미 하나뿐 — 분기 합(전 지역)이 이긴다.
      row({ period_grain: 'year', period: '2025', value: 40_000 }),
      row({ period_grain: 'ytd', period: '2026-9M', value: 30_000 }),
    ]);
    const annual = tab.charts[0].views.find((v) => v.key === 'annual')!;
    expect(annual.data.map((p) => [p.period_label, p.total])).toEqual([
      ['2025', 60],
      ['26 1~9월', 45],
    ]);
    expect(annual.note).toBe('2025 = 발표된 분기 합 · 26 1~9월 = 발표된 분기 합');
  });

  it('마지막 해 연간 값이 이미 있으면 누계 막대를 붙이지 않는다', () => {
    const [tab] = buildBreakdown([
      row({ period_grain: 'year', period: '2025', value: 400_000 }),
      row({ period_grain: 'ytd', period: '2025-9M', value: 300_000 }),
    ]);
    expect(tab.charts[0].views[0].data.map((p) => p.period_label)).toEqual(['2025']);
  });

  it('점유율 연간 표 끝에 올해 누계 칸 · 칸 호버 = 전년 동기 대비 %p', () => {
    const share = (o: Partial<BreakdownRow>) =>
      row({ kind: 'share', metric: 'market_share', unit: 'share_pct', ...o });
    const [tab] = buildBreakdown([
      share({ period_grain: 'year', period: '2024', value: 6.0 }),
      share({ period_grain: 'year', period: '2025', value: 6.5 }),
      share({ period_grain: 'ytd', period: '2025-9M', value: 6.4 }),
      share({ period_grain: 'ytd', period: '2026-6M', value: 6.6 }),
      share({ period_grain: 'ytd', period: '2026-9M', value: 6.9 }),
    ]);
    const [y] = tab.tables;
    expect(y.columns.map((c) => [c.label, c.prevLabel])).toEqual([
      ['2024', '2023'],
      ['2025', '2024'],
      ['26 1~9월', '25 1~9월'],
    ]);
    expect(y.rows).toEqual([{ label: '북미', values: [6, 6.5, 6.9], yoy: [null, 0.5, 0.5] }]);
  });
});

// Codex diff 검토(2026-11-12)가 찾은 경계 — 앞 시험들은 이 입력을 덮지 못했다.
describe('누계·전년 비교의 경계', () => {
  const share = (o: Partial<BreakdownRow>) =>
    row({ kind: 'share', metric: 'market_share', unit: 'share_pct', ...o });

  it('월·반기 H2 의 전년 동기 — 같은 꼬리의 한 해 전(시점은 없음)', () => {
    const [tab] = buildBreakdown([
      row({ period_grain: 'month', period: '2025-09', value: 10_000 }),
      row({ period_grain: 'month', period: '2026-09', value: 12_000 }),
    ]);
    const v = tab.charts[0].views[0];
    expect(v.key).toBe('month');
    expect(v.data[1].yoy).toEqual({ label: '25.09', total: 20, regions: { 북미: 20 } });
  });

  it('12개월 누계는 그 해 연간 값이다(사라지지 않는다)', () => {
    const [tab] = buildBreakdown([
      row({ period_grain: 'year', period: '2025', value: 400_000 }),
      row({ period_grain: 'ytd', period: '2026-12M', value: 440_000 }),
    ]);
    const v = tab.charts[0].views[0];
    expect(v.data.map((p) => [p.period_label, p.total])).toEqual([
      ['2025', 400],
      ['2026', 440],
    ]);
    expect(v.data[1].yoy?.total).toBe(10);
  });

  it('흐름이 아닌 분기(25Q2·26Q2)나 단독 Q2 도 분기 보기로 남는다', () => {
    const [two] = buildBreakdown([
      row({ period: '2025-Q2', value: 100_000 }),
      row({ period: '2026-Q2', value: 110_000 }),
    ]);
    expect(two.charts[0].views.map((v) => v.key)).toEqual(['quarter']);
    expect(two.charts[0].views[0].data[1].yoy?.total).toBe(10);
    const [one] = buildBreakdown([row({ period: '2026-Q2', value: 100_000 })]);
    expect(one.charts[0].views[0].data.map((p) => p.period_label)).toEqual(['26Q2']);
  });

  it('최신 분기에서 구분이 바뀌면 이름이 같은 앞 분기까지의 합으로 물러선다', () => {
    const [tab] = buildBreakdown([
      row({ period: '2025-Q1', value: 90_000 }),
      row({ period: '2025-Q2', value: 90_000 }),
      row({ period: '2026-Q1', value: 100_000 }),
      row({ period: '2026-Q2', value: 100_000 }),
      row({ period: '2026-Q3', value: 100_000 }),
      row({ period: '2026-Q3', label_raw: 'Europe', label_ko: '유럽', value: 50_000 }),
    ]);
    const annual = tab.charts[0].views.find((v) => v.key === 'annual')!;
    expect(annual.data.map((p) => [p.period_label, p.total])).toEqual([['26 1~6월', 200]]);
    expect(annual.data[0].yoy?.label).toBe('25 1~6월');
  });

  it('출처에는 올해 막대에 있는 구분의 전년 행만 — 안 그린 전년 누계의 다른 구분 쪽은 빠진다', () => {
    // 전년 1~9월 누계는 막대가 아니라 YoY 의 바탕일 뿐이다 — 거기서 쓰인 것은 올해에도 있는 북미뿐.
    const [tab] = buildBreakdown([
      row({ period_grain: 'year', period: '2024', value: 400_000, page: 3 }),
      row({ period_grain: 'ytd', period: '2025-9M', value: 300_000, page: 3 }),
      row({
        period_grain: 'ytd',
        period: '2025-9M',
        label_raw: 'Europe',
        label_ko: '유럽',
        value: 100_000,
        page: 99,
      }),
      row({ period_grain: 'ytd', period: '2026-9M', value: 330_000, document_id: 2, page: 5 }),
    ]);
    expect(tab.charts[0].views[0].data.map((p) => p.period_label)).toEqual(['2024', '26 1~9월']);
    expect(tab.sources.find((s) => s.docId === 1)?.pages).toEqual([3]);
    expect(tab.terms.map((t) => t.label)).not.toContain('유럽');
  });

  it('점유율 — 그 해 분기가 Q1 뿐이면 1분기를 1~3월 누계 칸으로', () => {
    const [tab] = buildBreakdown([
      share({ period_grain: 'year', period: '2025', value: 6 }),
      share({ period_grain: 'quarter', period: '2025-Q1', value: 5.5 }),
      share({ period_grain: 'quarter', period: '2026-Q1', value: 7 }),
    ]);
    const y = tab.tables.find((t) => t.key.endsWith('|year'))!;
    expect(y.columns.map((c) => [c.label, c.prevLabel])).toEqual([
      ['2025', '2024'],
      ['26 1~3월', '25 1~3월'],
    ]);
    expect(y.rows[0].values).toEqual([6, 7]);
    expect(y.rows[0].yoy).toEqual([null, 1.5]);
  });

  it('점유율 — 올해 「1~6월 누계」 와 전년 「상반기」 는 같은 기간으로 비교한다', () => {
    const [tab] = buildBreakdown([
      share({ period_grain: 'year', period: '2025', value: 6 }),
      share({ period_grain: 'half', period: '2025-H1', value: 6 }),
      share({ period_grain: 'ytd', period: '2026-6M', value: 7 }),
    ]);
    const y = tab.tables.find((t) => t.key.endsWith('|year'))!;
    expect(y.columns.at(-1)).toMatchObject({ label: '26 1~6월', prevLabel: '25 1~6월' });
    expect(y.rows[0].yoy.at(-1)).toBe(1);
  });
});
