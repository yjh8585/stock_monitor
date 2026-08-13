import { describe, expect, it } from 'vitest';
import {
  buildSeries,
  compareForDisplay,
  cutoffMonth,
  mapOutlookRow,
  MODEL_DISPLAY_ORDER,
  pickLatestPerModel,
  TREND_MONTHS,
  TREND_RIVALS,
} from './source';

const BASE_ROW = {
  model_key: 'grand_cherokee',
  model_name: 'Jeep Grand Cherokee',
  oem_group: 'Stellantis',
  region: 'North America',
  note_date: '2026-08-13',
  label: 'RED',
  sales_trend: null,
  competitive_view: null,
  consumer_view: 'c',
  outlook: 'o',
  rationale: 'r',
  market_breakdown: null,
  metrics: null,
  sources: null,
};

describe('mapOutlookRow', () => {
  it('JSONB 컬럼이 null 이어도 빈 배열로 안전하게 매핑된다', () => {
    const out = mapOutlookRow(BASE_ROW);
    expect(out.markets).toEqual([]);
    expect(out.sources).toEqual([]);
    expect(out.modelKey).toBe('grand_cherokee');
  });

  it('market_breakdown 과 metrics 를 시장 코드로 이어 붙인다', () => {
    const out = mapOutlookRow({
      ...BASE_ROW,
      market_breakdown: [
        {
          market: 'USA',
          label: '미국',
          sales: 207935,
          yoy_pct: -1.2,
          share_pct: 17.1,
          prev_share_pct: 19.6,
          anchor_month: 202607,
          months: 12,
          comment: '3열 SUV 경쟁 심화',
        },
      ],
      metrics: {
        markets: [
          {
            market: 'USA',
            segment_note: 'SUV-E',
            competitors: [{ model: 'Explorer', sales: 244769, yoy_pct: 22.3 }],
          },
        ],
        inventory: { brand: 'Jeep', days_supply: 160, year_month: 202606 },
        safety: { model_year: 2026, recalls: { count: 3 }, complaint_count: 23 },
        competitor_inventory: [
          {
            market: 'USA',
            models: [{ model: 'Explorer', brand: 'Ford', days_supply: 93, year_month: 202606 }],
          },
        ],
        competitor_safety: [
          {
            market: 'USA',
            models: [{ model: 'Explorer', model_year: 2026, recall_count: 0, complaint_count: 24 }],
          },
        ],
        consumer_scores: [
          {
            market: 'USA',
            scores: [
              {
                model: 'Jeep Grand Cherokee',
                is_target: true,
                design: 4,
                price: 3,
                quality: 2,
                efficiency: 3,
                brand: 4,
              },
            ],
          },
        ],
      },
    });

    const m = out.markets[0];
    expect(m.segmentNote).toBe('SUV-E');
    expect(m.competitors).toHaveLength(1);
    expect(m.consumerScores).toHaveLength(1);
    // 대상 차종은 model 없이, 경쟁은 model 과 함께 — 화면이 이 유무로 둘을 가른다
    expect(m.inventory.map((i) => i.model)).toEqual([undefined, 'Explorer']);
    expect(m.safety.map((s) => s.model)).toEqual([undefined, 'Explorer']);
  });

  it('미국 기준 지표(재고·리콜)는 비미국 시장 탭에 붙이지 않는다 — 대상도 경쟁도', () => {
    // 실측 회귀(2026-08-13): 셀토스 한국 경쟁군의 Kona·Trailblazer 는 미국에서도 팔려
    // oem_model_brand 에 매핑이 있다 → 수집기가 한국 시장 블록에 미국 재고를 담는다.
    // 수집기는 시장을 모르므로 여기서 걸러야 한다.
    const out = mapOutlookRow({
      ...BASE_ROW,
      model_key: 'seltos',
      market_breakdown: [
        {
          market: 'Korea',
          label: '한국',
          sales: 1,
          yoy_pct: 0,
          share_pct: null,
          prev_share_pct: null,
          comment: '',
        },
      ],
      metrics: {
        markets: [{ market: 'Korea', competitors: [] }],
        inventory: { brand: 'Kia', days_supply: 74, year_month: 202606 },
        safety: { model_year: 2026, recalls: { count: 0 }, complaint_count: 1 },
        competitor_inventory: [
          {
            market: 'Korea',
            models: [{ model: 'Kona', brand: 'Hyundai', days_supply: 101, year_month: 202606 }],
          },
        ],
        competitor_safety: [
          {
            market: 'Korea',
            models: [{ model: 'Kona', model_year: 2026, recall_count: 1, complaint_count: 3 }],
          },
        ],
      },
    });
    expect(out.markets[0].inventory).toEqual([]);
    expect(out.markets[0].safety).toEqual([]);
  });

  it('complaint_count 가 null(조회 실패)이어도 0 으로 바꾸지 않는다', () => {
    const out = mapOutlookRow({
      ...BASE_ROW,
      market_breakdown: [
        {
          market: 'USA',
          label: '미국',
          sales: 1,
          yoy_pct: 0,
          share_pct: null,
          prev_share_pct: null,
          comment: '',
        },
      ],
      metrics: {
        markets: [{ market: 'USA', competitors: [] }],
        safety: { model_year: 2026, recalls: { count: 2 }, complaint_count: null },
      },
    });
    expect(out.markets[0].safety[0].complaint_count).toBeNull();
  });
});

describe('pickLatestPerModel', () => {
  it('차종별로 note_date 가 가장 최근인 행만 남긴다', () => {
    const rows = [
      { model_key: 'a', note_date: '2026-08-10' },
      { model_key: 'a', note_date: '2026-08-17' },
      { model_key: 'b', note_date: '2026-08-17' },
    ];
    const out = pickLatestPerModel(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.model_key === 'a')?.note_date).toBe('2026-08-17');
  });
});

describe('compareForDisplay — 사용자 지정 순서', () => {
  it('스텔란티스 → 아틀라스 → 리비안 → 포르쉐 → 현대기아 순으로 정렬한다', () => {
    const shuffled = [...MODEL_DISPLAY_ORDER].map((model_key) => ({ model_key })).reverse();
    expect(shuffled.sort(compareForDisplay).map((r) => r.model_key)).toEqual([
      ...MODEL_DISPLAY_ORDER,
    ]);
  });

  it('그랜드체로키가 항상 첫 번째다', () => {
    const rows = [{ model_key: 'niro' }, { model_key: 'grand_cherokee' }, { model_key: 'atlas' }];
    expect(rows.sort(compareForDisplay)[0].model_key).toBe('grand_cherokee');
  });

  it('목록에 없는 차종은 뒤로 밀리고 그 안에서 사전순', () => {
    const rows = [{ model_key: 'zzz_new' }, { model_key: 'aaa_new' }, { model_key: 'niro' }];
    expect(rows.sort(compareForDisplay).map((r) => r.model_key)).toEqual([
      'niro',
      'aaa_new',
      'zzz_new',
    ]);
  });
});

describe('cutoffMonth', () => {
  it('연 경계를 넘어 계산한다', () => {
    expect(cutoffMonth(202607, 24)).toBe(202408);
    expect(cutoffMonth(202601, 12)).toBe(202502);
    expect(cutoffMonth(202612, 1)).toBe(202612);
  });
});

describe('buildSeries', () => {
  const rows = (model: string, isTarget: boolean, months: number[]) =>
    months.map((year_month) => ({
      model_key: 'grand_cherokee',
      market: 'USA',
      model,
      is_target: isTarget,
      year_month,
      sales: 100,
    }));

  const competitors = [
    { model: 'Explorer', sales: 244769, yoy_pct: 22.3 },
    { model: 'Traverse', sales: 166855, yoy_pct: 27.2 },
    { model: 'Grand Highlander', sales: 147454, yoy_pct: 59.2 },
    { model: 'Telluride', sales: 136786, yoy_pct: 9.7 },
  ];

  it('대상이 맨 앞, 경쟁은 판매 내림차순으로 상위 3종만 남는다', () => {
    const all = [
      ...rows('Grand Cherokee', true, [202607]),
      ...competitors.flatMap((c) => rows(c.model, false, [202607])),
    ];
    const out = buildSeries(all, competitors);
    expect(out.map((s) => s.model)).toEqual([
      'Grand Cherokee',
      'Explorer',
      'Traverse',
      'Grand Highlander',
    ]);
    expect(out).toHaveLength(TREND_RIVALS + 1);
    expect(out[0].isTarget).toBe(true);
  });

  it('표시 개월 수보다 오래된 달은 잘라낸다', () => {
    const out = buildSeries(rows('Grand Cherokee', true, [202307, 202408, 202607]), []);
    expect(out[0].points.map((p) => p.yearMonth)).toEqual([202408, 202607]);
    expect(cutoffMonth(202607, TREND_MONTHS)).toBe(202408);
  });

  it('월 순서가 뒤섞여 들어와도 오름차순으로 정렬한다', () => {
    const out = buildSeries(rows('Grand Cherokee', true, [202607, 202501, 202606]), []);
    expect(out[0].points.map((p) => p.yearMonth)).toEqual([202501, 202606, 202607]);
  });

  it('행이 없으면 빈 배열', () => {
    expect(buildSeries([], competitors)).toEqual([]);
  });
});
