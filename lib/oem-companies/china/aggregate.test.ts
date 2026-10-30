/**
 * 중국 탭 사전 가공 단위 테스트 — pure 함수, mocking 없음. fixture 는 테스트마다 inline.
 */
import { describe, expect, it } from 'vitest';
import {
  buildExportGroupMonth,
  buildExportTagMix,
  buildExportTopModels,
  buildFlows,
  buildKpi,
  buildProductionGroupMonth,
  buildProductionTopModels,
  buildPtMix,
  buildTypeSegMonth,
  exportTagPowertrain,
  minYm,
  modelLabel,
  resolvePeriods,
  type ChinaExportRow,
  type ChinaProductionRow,
} from './aggregate';

function prod(
  cn_group: string,
  maker_brand: string,
  model: string,
  powertrain: string,
  year_month: number,
  production: number
): ChinaProductionRow {
  return { cn_group, maker_brand, model, powertrain, year_month, production };
}

function exp(
  cn_group: string,
  brand: string,
  model: string,
  ev_tag: string | null,
  year_month: number,
  export_volume: number
): ChinaExportRow {
  return { cn_group, brand, model, ev_tag, year_month, export_volume };
}

const P = resolvePeriods(202609, 202609)!;

describe('resolvePeriods', () => {
  it('생산·수출 최신월 중 이른 쪽이 앵커다', () => {
    const p = resolvePeriods(202609, 202608)!;
    expect(p.anchorYm).toBe(202608);
    expect(p.fullYear).toBe(2025);
    expect(p.ytdLabel).toBe('2026 1~8월');
    expect(p.prevYtdLabel).toBe('2025 1~8월');
  });

  it('12월이면 그 해가 찬 해다', () => {
    expect(resolvePeriods(202512, 202512)!.fullYear).toBe(2025);
  });

  it('한쪽이라도 비면 null', () => {
    expect(resolvePeriods(0, 202609)).toBeNull();
  });

  it('시작월은 데이터에서 읽는다 — 행이 없으면 0', () => {
    expect(minYm([{ year_month: 201901 }, { year_month: 201801 }])).toBe(201801);
    expect(minYm([])).toBe(0);
  });
});

describe('buildKpi', () => {
  it('찬 해·YTD·EV 비중을 회사 탭 KPI 모양으로 낸다', () => {
    const rows = [
      prod('BYD', 'BYD', 'Seal', 'EV', 202503, 60),
      prod('BYD', 'BYD', 'Qin', 'ICE', 202511, 40),
      prod('BYD', 'BYD', 'Qin', 'ICE', 202403, 50),
      prod('BYD', 'BYD', 'Qin', 'ICE', 202601, 30),
      prod('BYD', 'BYD', 'Qin', 'ICE', 202610, 999), // 앵커 뒤 — 제외
    ];
    const k = buildKpi(rows, P);
    expect(k).toMatchObject({
      latestYearLabel: '2025년 승용 생산',
      latestYearSales: 100,
      prevYearSales: 50,
      yoyPct: 100,
      ytdLabel: '2026 YTD (1~9월)',
      ytdCurrent: 30,
      ytdPrevLabel: '2025 1~9월',
      ytdPrev: 60, // 2025.03 만 1~9월 안
      evRatio: 60,
      latestPeriod: '2026-09',
    });
  });

  it('12월까지 차면 다음 해 YTD 는 대기 · 비교 칸은 그해 연간(KG 와 같다)', () => {
    const k = buildKpi([prod('A', 'A', 'x', 'ICE', 202512, 5)], resolvePeriods(202512, 202512)!);
    expect(k).toMatchObject({
      ytdLabel: '2026 YTD (대기)',
      ytdCurrent: 0,
      ytdPrevLabel: '2025 연간',
      ytdPrev: 5,
      ytdYoyPct: null,
    });
  });
});

describe('buildFlows', () => {
  it('내수 = 생산 − 수출, 막대 합계는 생산, 연간 라벨은 연도만(KG 관례)', () => {
    const rows = [
      prod('BYD', 'BYD', 'Qin', 'ICE', 202512, 100),
      prod('BYD', 'BYD', 'Qin', 'ICE', 202601, 80),
    ];
    const exports = [exp('BYD', 'BYD', 'Qin', null, 202512, 30)];
    const { monthly, annual } = buildFlows(rows, exports, P);
    expect(monthly.map((m) => [m.period_label, m.domestic, m.export, m.total])).toEqual([
      ['2025.12', 70, 30, 100],
      ['2026.01', 80, 0, 80],
    ]);
    expect(annual.map((a) => a.period_label)).toEqual(['2025', '2026']);
  });

  it('생산이 한 달 앞서도 앵커(이른 쪽) 뒤 달은 월간·연간 어디에도 안 담는다', () => {
    // 담으면 그 달은 수출 0 으로 보여 내수 추정이 부풀려진다
    const p = resolvePeriods(202609, 202608)!;
    const rows = [
      prod('BYD', 'BYD', 'Qin', 'ICE', 202608, 100),
      prod('BYD', 'BYD', 'Qin', 'ICE', 202609, 500),
    ];
    const exports = [exp('BYD', 'BYD', 'Qin', null, 202608, 40)];
    const { monthly, annual } = buildFlows(rows, exports, p);
    expect(monthly.map((m) => m.period)).toEqual(['202608']);
    expect(annual).toEqual([
      { period: '2026', period_label: '2026', domestic: 60, export: 40, total: 100 },
    ]);
  });
});

describe('buildPtMix', () => {
  it('모르는 파워트레인은 Unknown 으로 모으고 total 에 넣는다', () => {
    const { annual, monthly } = buildPtMix(
      [prod('A', 'A', 'x', 'EV', 202601, 3), prod('A', 'A', 'y', 'EREV', 202601, 1)],
      P
    );
    expect(annual[0]).toMatchObject({ EV: 3, Unknown: 1, total: 4, period_label: '2026' });
    expect(monthly[0]).toMatchObject({ EV: 3, Unknown: 1, total: 4, period_label: '2026.01' });
  });

  it('앵커 뒤 달은 비중에 넣지 않는다', () => {
    const { annual, monthly } = buildPtMix(
      [prod('A', 'A', 'x', 'EV', 202608, 3), prod('A', 'A', 'x', 'ICE', 202609, 9)],
      resolvePeriods(202609, 202608)!
    );
    expect(monthly.map((m) => m.period)).toEqual(['202608']);
    expect(annual[0]).toMatchObject({ EV: 3, ICE: 0, total: 3 });
  });
});

describe('순위 행 (전체 탭 차트 입력)', () => {
  const rows = [
    prod('FAW', 'Audi', 'A4', 'ICE', 202601, 100),
    prod('FAW', 'Audi', 'Q5', 'ICE', 202601, 5),
    prod('FAW', 'Hongqi', 'H5', 'ICE', 202601, 30),
    prod('FAW', 'Audi', 'A4', 'ICE', 202401, 150),
    prod('FAW', 'Audi', 'A4', 'ICE', 202312, 777), // p.fullYear(2025) − 1 이전 — 어느 차트도 안 읽는다
    prod('FAW', 'Audi', 'A4', 'ICE', 202610, 999), // 앵커 뒤 — 제외
  ];

  it('모회사는 같은 달 브랜드·모델을 한 행으로 합친다', () => {
    const r = buildProductionGroupMonth(rows, P);
    expect(r.group).toEqual([
      { oem_group: 'FAW', year_month: 202601, sales: 135 },
      { oem_group: 'FAW', year_month: 202401, sales: 150 },
    ]);
    expect(r.brand).toContainEqual({ oem_group: 'Audi', year_month: 202601, sales: 105 });
  });

  it('수출은 brand 칸으로 묶고, TOP30 이 읽는 앵커 연도와 그 전해만 싣는다', () => {
    const r = buildExportGroupMonth(
      [
        exp('SAIC', 'MG', 'MG4', 'EV', 202602, 9),
        exp('SAIC', 'MG', 'MG4', 'EV', 202501, 4),
        exp('SAIC', 'MG', 'MG4', 'EV', 202412, 7), // 그 전전해 — 제외
      ],
      P
    );
    expect(r.group).toEqual([
      { oem_group: 'SAIC', year_month: 202602, sales: 9 },
      { oem_group: 'SAIC', year_month: 202501, sales: 4 },
    ]);
    expect(r.brand).toContainEqual({ oem_group: 'MG', year_month: 202602, sales: 9 });
  });

  it('차종 구조는 production 을 sales 로 옮기고 마지막 완결 연도만 싣는다', () => {
    expect(
      buildTypeSegMonth(
        [
          { vehicle_type: 'SUV', segment: 'SUV-C', year_month: 202501, production: 7 },
          { vehicle_type: 'SUV', segment: 'SUV-C', year_month: 202301, production: 1 },
          { vehicle_type: 'SUV', segment: 'SUV-C', year_month: 202601, production: 2 },
        ],
        P
      )
    ).toEqual([{ vehicle_type: 'SUV', segment: 'SUV-C', year_month: 202501, sales: 7 }]);
  });
});

describe('모델 TOP', () => {
  it('동력원이 둘 이상이면 Multi, 브랜드가 없으면 붙인다', () => {
    const r = buildProductionTopModels(
      [
        prod('BYD', 'BYD', 'Song PLUS', 'EV', 202601, 5),
        prod('BYD', 'BYD', 'Song PLUS', 'PHEV', 202601, 7),
        prod('BYD', 'BYD', 'Song PLUS', 'PHEV', 202501, 4),
        prod('FAW', 'Audi', 'Audi A4', 'ICE', 202601, 3),
      ],
      P
    );
    expect(r.rows.map((x) => [x.model, x.ytdSales, x.ytdPrevSales, x.resolvedPt])).toEqual([
      ['BYD Song PLUS', 12, 4, 'Multi'],
      ['Audi A4', 3, 0, 'ICE'],
    ]);
    expect(r.totals.ytd).toBe(15);
    expect(r.totals.latestPeriod).toBe(4);
  });

  it('12월까지 찬 해는 YTD 칸을 비우고 연간으로 줄 세운다(칸 중복 방지)', () => {
    const r = buildProductionTopModels(
      [
        prod('BYD', 'BYD', 'Seal', 'EV', 202512, 5),
        prod('BYD', 'BYD', 'Qin', 'ICE', 202506, 9),
        prod('BYD', 'BYD', 'Qin', 'ICE', 202406, 3),
      ],
      resolvePeriods(202512, 202512)!
    );
    expect(r.rows.map((x) => [x.model, x.salesLatestPeriod, x.ytdSales, x.resolvedPt])).toEqual([
      ['BYD Qin', 9, 0, 'ICE'],
      ['BYD Seal', 5, 0, 'EV'],
    ]);
    expect(r.totals).toMatchObject({ latestPeriod: 14, prevPeriod: 3, ytd: 0, ytdPrev: 0 });
  });

  it('수출 모델은 브랜드 칸을 채운다', () => {
    const r = buildExportTopModels([exp('Chery', 'Chery', 'Tiggo 7', 'PHV/ICE', 202601, 9)], P);
    expect(r.rows[0]).toMatchObject({ model: 'Tiggo 7', brand: 'Chery', resolvedPt: null });
  });

  it('modelLabel 은 대소문자를 가리지 않는다', () => {
    expect(modelLabel('MG', 'MG4')).toBe('MG4');
    expect(modelLabel('Tesla', 'Model Y')).toBe('Tesla Model Y');
  });
});

describe('exportTagPowertrain', () => {
  // 2026-10-30 DB 의 실제 표기 전부
  it.each([
    ['', 'Unknown'],
    ['EV', 'EV'],
    ['PHV', 'PHEV'],
    ['HV', 'HV'],
    ['MHV', 'HV'],
    ['ICE', 'ICE'],
    ['EV/FCV', 'Multi'],
    ['EV/PHV', 'Multi'],
    ['PHV/EV', 'Multi'],
    ['PHV/ICE', 'Multi'],
    ['ICE/EV', 'Multi'],
    ['EV/ICE', 'Multi'],
    ['EV/PHV/ICE', 'Multi'],
    ['HV/PHV/ICE', 'Multi'],
    ['EV/HV/ICE', 'Multi'],
    ['ICE/PHV', 'Multi'],
    ['EV/HV/PHV/ICE', 'Multi'],
    ['MHV/PHV', 'Multi'],
    ['HV/PHV', 'Multi'],
    ['ICE/PHV/MHV', 'Multi'],
    ['ICE/PHV/HV', 'Multi'],
    ['MHV/PHV/ICE', 'Multi'],
    ['EV/MHV', 'Multi'],
    ['ICE/EV/PHV', 'Multi'],
    ['EV/FCV/ICE', 'Multi'],
    ['HV/ICE', 'Multi'],
    ['ICE/HV', 'Multi'],
    ['MHV/ICE', 'Multi'],
    ['ICE/MHV', 'Multi'],
  ])('%s → %s', (tag, want) => {
    expect(exportTagPowertrain(tag)).toBe(want);
  });

  it('모르는 토큰은 조용히 다른 칸에 넣지 않는다', () => {
    expect(exportTagPowertrain('EV/EREV')).toBe('Unknown');
    // `in` 으로 보면 프로토타입 키가 참이 되어 undefined 칸이 생긴다
    expect(exportTagPowertrain('constructor')).toBe('Unknown');
    expect(exportTagPowertrain('EV/toString')).toBe('Unknown');
  });

  it('EV 열이 없던 해(null)는 비중에서 뺀다', () => {
    const { annual } = buildExportTagMix(
      [
        exp('A', 'A', 'x', null, 202101, 5),
        exp('A', 'A', 'x', 'EV', 202201, 2),
        exp('A', 'A', 'y', '', 202201, 3),
      ],
      P
    );
    expect(annual.map((m) => [m.period, m.EV, m.Unknown, m.total])).toEqual([['2022', 2, 3, 5]]);
  });
});
