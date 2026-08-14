import { describe, expect, it } from 'vitest';
import {
  buildBrandInventory,
  buildCoxSeries,
  buildInventoryTrend,
  buildPeriods,
  buildSeries,
  buildShareTrend,
  compareForDisplay,
  cutoffMonth,
  mapOutlookRow,
  MODEL_DISPLAY_ORDER,
  periodWindow,
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

  it('표시 구간 밖의 12개월 전 실적으로 YoY 를 낸다', () => {
    // 202508 은 표시 구간(202408~) 안이지만 비교 대상 202408 도 창 안이다.
    // 202408 자신의 비교 대상(202308)은 창 밖 — 잘라내기 전 원계열에서 찾아 계산해야 한다.
    const all = [
      { ...rows('Grand Cherokee', true, [202308])[0], sales: 100 },
      { ...rows('Grand Cherokee', true, [202408])[0], sales: 150 },
      { ...rows('Grand Cherokee', true, [202508])[0], sales: 120 },
    ];
    const out = buildSeries(all, []);
    const points = out[0].points;
    expect(points.map((p) => p.yearMonth)).toEqual([202408, 202508]);
    expect(points[0].yoyPct).toBe(50); // 100 → 150
    expect(points[1].yoyPct).toBe(-20); // 150 → 120
  });

  it('12개월 전 실적이 없으면 YoY 는 null (0 으로 뭉개지 않는다)', () => {
    const out = buildSeries(rows('Grand Cherokee', true, [202607]), []);
    expect(out[0].points[0].yoyPct).toBeNull();
  });
});

describe('periodWindow — 집계 창', () => {
  it('L12M 은 앵커 포함 12개월', () => {
    expect(periodWindow('L12M', 202606)).toEqual({ start: 202507, end: 202606 });
  });

  it('YTD 는 그 해 1월부터 앵커까지 — 창 길이가 달마다 다르다', () => {
    expect(periodWindow('YTD', 202606)).toEqual({ start: 202601, end: 202606 });
    expect(periodWindow('YTD', 202601)).toEqual({ start: 202601, end: 202601 });
  });

  it('전년 동기는 연도만 1 낮춘 같은 창', () => {
    expect(periodWindow('L12M', 202606, 1)).toEqual({ start: 202407, end: 202506 });
    expect(periodWindow('YTD', 202606, 1)).toEqual({ start: 202501, end: 202506 });
  });
});

describe('buildPeriods', () => {
  const row = (model: string, isTarget: boolean, ym: number, sales: number) => ({
    model_key: 'seltos',
    market: 'USA',
    model,
    is_target: isTarget,
    year_month: ym,
    sales,
  });

  /** 대상 12개월 + 전년 12개월, 경쟁 1종 동일 기간. */
  const twoYears = (model: string, isTarget: boolean, monthly: number) =>
    Array.from({ length: 24 }, (_, i) => {
      const total = 2024 * 12 + 6 + i; // 202407 부터 24개월
      const ym = Math.floor(total / 12) * 100 + (total % 12) + 1;
      return row(model, isTarget, ym, monthly);
    });

  it('앵커는 대상·경쟁의 최신월 중 이른 쪽 (수집기와 같은 규칙)', () => {
    const rows = [
      row('SELTOS', true, 202607, 100), // 대상만 한 달 더 있다
      row('SELTOS', true, 202606, 100),
      row('HR-V', false, 202606, 100),
    ];
    const periods = buildPeriods(rows);
    expect(periods.every((p) => p.anchorMonth === 202606)).toBe(true);
  });

  it('대상만 앞선 달을 빼지 않으면 점유율이 부풀려진다 — 앵커 밖 달은 집계에서 제외', () => {
    const rows = [
      row('SELTOS', true, 202607, 999), // 앵커(202606) 밖 — 들어가면 점유율이 튄다
      row('SELTOS', true, 202606, 100),
      row('HR-V', false, 202606, 100),
    ];
    const l12m = buildPeriods(rows).find((p) => p.basis === 'L12M');
    expect(l12m?.totalSales).toBe(200);
    expect(l12m?.models.find((m) => m.isTarget)?.sharePct).toBe(50);
  });

  it('L12M 과 YTD 가 서로 다른 창을 쓴다', () => {
    const rows = [...twoYears('SELTOS', true, 100), ...twoYears('HR-V', false, 100)];
    const periods = buildPeriods(rows);
    const l12m = periods.find((p) => p.basis === 'L12M');
    const ytd = periods.find((p) => p.basis === 'YTD');
    expect(l12m?.months).toBe(12);
    // 앵커 202606 → YTD 는 202601~202606 의 6개월
    expect(ytd?.months).toBe(6);
    expect(ytd?.label).toBe('2026년 누계(1~6월)');
    expect(l12m?.totalSales).toBe(2400); // 12개월 × 100 × 2종
    expect(ytd?.totalSales).toBe(1200); // 6개월 × 100 × 2종
  });

  it('대상 표기가 여러 개인 차종은 한 줄로 합산한다', () => {
    const rows = [
      row('Elantra Yuedong', true, 202606, 60),
      row('Elantra 2016', true, 202606, 40),
      row('Sylphy', false, 202606, 100),
    ];
    const l12m = buildPeriods(rows).find((p) => p.basis === 'L12M');
    const target = l12m?.models.filter((m) => m.isTarget) ?? [];
    expect(target).toHaveLength(1);
    expect(target[0].sales).toBe(100);
  });

  it('전년 실적이 없으면 전년 점유율은 null (0% 라고 단정하지 않는다)', () => {
    const rows = [row('SELTOS', true, 202606, 100), row('HR-V', false, 202606, 100)];
    const l12m = buildPeriods(rows).find((p) => p.basis === 'L12M');
    expect(l12m?.prevTotalSales).toBe(0);
    expect(l12m?.models[0].prevSharePct).toBeNull();
    expect(l12m?.models[0].yoyPct).toBeNull();
  });

  it('행이 없으면 빈 배열', () => {
    expect(buildPeriods([])).toEqual([]);
  });
});

describe('buildBrandInventory — Cox 이상치 판정', () => {
  const cox = (brand: string, ym: number, days: number | null, excluded = false) => ({
    brand,
    year_month: ym,
    days_supply: days,
    is_outlier_excluded: excluded,
  });

  it('최신 공개값과 그 직전 공개값을 함께 준다', () => {
    const out = buildBrandInventory([
      cox('Jeep', 202606, 160),
      cox('Jeep', 202605, 140),
      cox('Jeep', 202604, 120),
    ]);
    expect(out.get('Jeep')?.current).toEqual({ yearMonth: 202606, daysSupply: 160 });
    expect(out.get('Jeep')?.previous).toEqual({ yearMonth: 202605, daysSupply: 140 });
    expect(out.get('Jeep')?.outlierExcluded).toBe(false);
  });

  it('최신월이 이상치로 제외되면 플래그를 세우고 값은 마지막 공개월 것을 쓴다', () => {
    const out = buildBrandInventory([
      cox('Ram', 202606, null, true),
      cox('Ram', 202605, 144),
      cox('Jeep', 202606, 160),
    ]);
    const ram = out.get('Ram');
    expect(ram?.outlierExcluded).toBe(true);
    expect(ram?.outlierMonth).toBe(202606);
    // 값이 사라지면 비교 막대가 통째로 없어진다 — 마지막 공개값을 남긴다.
    expect(ram?.current).toEqual({ yearMonth: 202605, daysSupply: 144 });
  });

  it('연속 제외 구간의 시작월을 찾는다', () => {
    const out = buildBrandInventory([
      cox('Chrysler', 202606, null, true),
      cox('Chrysler', 202605, null, true),
      cox('Chrysler', 202604, 135),
    ]);
    expect(out.get('Chrysler')?.outlierMonth).toBe(202605);
  });

  it('🔴 그 달 로스터에서 빠진 브랜드를 이상치로 몰지 않는다', () => {
    // Lincoln 은 202606 행 자체가 없다(= 우리가 아는 게 없음). Jeep 이 그 달의 최신월을 정의한다.
    const out = buildBrandInventory([cox('Jeep', 202606, 160), cox('Lincoln', 202605, 90)]);
    expect(out.get('Lincoln')?.outlierExcluded).toBe(false);
    expect(out.get('Lincoln')?.current).toEqual({ yearMonth: 202605, daysSupply: 90 });
  });

  it('행이 없으면 빈 맵', () => {
    expect(buildBrandInventory([]).size).toBe(0);
  });
});

describe('buildShareTrend', () => {
  /** ym 오름차순으로 months 개월치 행을 만든다. gaps 에 든 달은 아예 행을 만들지 않는다(미판매). */
  function rows(
    model: string,
    isTarget: boolean,
    start: number,
    values: number[],
    gaps: number[] = []
  ) {
    return values
      .map((sales, i) => ({
        model_key: 'm',
        market: 'USA',
        model,
        is_target: isTarget,
        year_month: addYm(start, i),
        sales,
      }))
      .filter((r) => !gaps.includes(r.year_month));
  }

  /** 테스트 안에서만 쓰는 월 덧셈(source 의 addMonths 는 export 되지 않는다). */
  function addYm(ym: number, delta: number): number {
    const total = Math.floor(ym / 100) * 12 + ((ym % 100) - 1) + delta;
    return Math.floor(total / 12) * 100 + (total % 12) + 1;
  }

  const RIVALS = [{ model: 'Rival', sales: 1200, yoy_pct: null }];

  it('12개월 창이 다 찬 달부터 점유율을 낸다', () => {
    // 202401~202412 (12개월). 창이 완전한 달은 마지막 202412 하나뿐이다.
    const monthly = [
      ...rows('Target', true, 202401, Array(12).fill(100)),
      ...rows('Rival', false, 202401, Array(12).fill(300)),
    ];
    const out = buildShareTrend(monthly, RIVALS);
    const target = out.find((s) => s.isTarget);
    expect(target).toBeDefined();

    const complete = target!.points.filter((p) => p.sharePct !== null);
    expect(complete).toHaveLength(1);
    expect(complete[0].yearMonth).toBe(202412);
    // 1200 / (1200 + 3600) = 25%
    expect(complete[0].sharePct).toBe(25);
  });

  it('🔴 경쟁차의 결측월이 있어도 선이 통째로 비지 않는다', () => {
    // 이 케이스가 실제로 화면을 비웠다(2026-08-14). 경쟁차는 안 팔린 달에 행이 아예 없다.
    const monthly = [
      ...rows('Target', true, 202401, Array(13).fill(100)),
      ...rows('Rival', false, 202401, Array(13).fill(300), [202405, 202409]),
    ];
    const out = buildShareTrend(monthly, RIVALS);
    for (const s of out) {
      expect(s.points.some((p) => p.sharePct !== null)).toBe(true);
    }
    // 경쟁차가 두 달 빠졌으니 대상 점유율은 25% 보다 높아야 한다(0 으로 세기 때문).
    const last = out.find((s) => s.isTarget)!.points.at(-1)!;
    expect(last.sharePct).toBeGreaterThan(25);
  });

  it('창이 덜 찬 앞 구간은 null — 0 으로 채우지 않는다', () => {
    const monthly = rows('Target', true, 202401, Array(12).fill(100));
    const out = buildShareTrend(monthly, []);
    expect(out[0].points[0].sharePct).toBeNull();
  });

  it('행이 없으면 빈 배열', () => {
    expect(buildShareTrend([], [])).toEqual([]);
  });
});

describe('buildInventoryTrend', () => {
  const COX = [
    { brand: 'Jeep', year_month: 202605, days_supply: 144, is_outlier_excluded: false },
    { brand: 'Jeep', year_month: 202606, days_supply: null, is_outlier_excluded: true },
    { brand: 'Ford', year_month: 202606, days_supply: 93, is_outlier_excluded: false },
  ];

  it('model 이 없는 항목을 대상으로 본다 (배열 순서에 기대지 않는다)', () => {
    const out = buildInventoryTrend(
      [
        { brand: 'Ford', model: 'Explorer', days_supply: 93, year_month: 202606 },
        { brand: 'Jeep', days_supply: 144, year_month: 202605 },
      ],
      buildCoxSeries(COX)
    );
    expect(out.find((t) => t.brand === 'Jeep')?.isTarget).toBe(true);
    expect(out.find((t) => t.brand === 'Ford')?.isTarget).toBe(false);
  });

  it('🔴 값이 감춰진 달을 버리지 않는다 — 그 자체가 신호다', () => {
    const out = buildInventoryTrend(
      [{ brand: 'Jeep', days_supply: 144, year_month: 202605 }],
      buildCoxSeries(COX)
    );
    const jeep = out[0].points;
    expect(jeep).toHaveLength(2);
    expect(jeep[1]).toEqual({ yearMonth: 202606, daysSupply: null, outlierExcluded: true });
  });

  it('Cox 로스터에 없는 브랜드는 건너뛴다', () => {
    const out = buildInventoryTrend(
      [{ brand: 'Rivian', days_supply: null, year_month: 202606 }],
      buildCoxSeries(COX)
    );
    expect(out).toEqual([]);
  });
});

describe('buildCoxSeries', () => {
  it('브랜드별로 월 오름차순 정렬한다', () => {
    const out = buildCoxSeries([
      { brand: 'Jeep', year_month: 202606, days_supply: 1, is_outlier_excluded: false },
      { brand: 'Jeep', year_month: 202601, days_supply: 2, is_outlier_excluded: false },
    ]);
    expect(out.get('Jeep')!.map((r) => r.year_month)).toEqual([202601, 202606]);
  });
});
