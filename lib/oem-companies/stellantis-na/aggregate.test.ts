/**
 * Stellantis NA aggregate.ts 단위 테스트 — pure 함수, mocking 없음.
 * fixture는 각 테스트 안에 inline.
 */
import { describe, expect, it } from 'vitest';
import type {
  StellantisNaSaleRow,
  StellantisNaSaleRowWithPt,
  VehiclePowertrainMapRow,
} from '@/lib/types';
import {
  aggregateAnnualBrandStack,
  aggregateAnnualSeries,
  aggregateKpi,
  aggregatePtMixAnnual,
  aggregatePtMixQuarterly,
  aggregateQuarterlyBrandStack,
  aggregateQuarterlySeries,
  aggregateTopModels,
  attachPowertrains,
  formatPeriodLabel,
  MIN_YOY_PREV_SALES,
  sortBrandsByTotal,
  STELLANTIS_NA_BRANDS,
} from './aggregate';

function row(opts: {
  period?: string;
  brand?: string;
  model: string;
  units: number;
  periodType?: StellantisNaSaleRow['period_type'];
  region?: string;
}): StellantisNaSaleRow {
  return {
    period_type: opts.periodType ?? 'quarter',
    year_period: opts.period ?? '2025-Q1',
    brand: opts.brand ?? 'Jeep',
    vehicle_model: opts.model,
    region: opts.region ?? 'US',
    sales_units: opts.units,
    sales_units_prev: null,
    yoy_pct: null,
    source_url: null,
    release_id: null,
    publish_date: null,
  };
}

function ptRow(
  model: string,
  pt: VehiclePowertrainMapRow['powertrain'],
  opts: Partial<VehiclePowertrainMapRow> = {}
): VehiclePowertrainMapRow {
  return {
    company_slug: 'stellantis-na',
    vehicle_model: model,
    powertrain: pt,
    valid_from: opts.valid_from ?? '2021-01-01',
    valid_to: opts.valid_to ?? null,
    source_note: opts.source_note ?? null,
  };
}

function withPt(rows: StellantisNaSaleRow[]): StellantisNaSaleRowWithPt[] {
  return rows.map((r) => ({ ...r, resolved_powertrain: null }));
}

describe('formatPeriodLabel', () => {
  it('quarter: YYYY-QN → YYQN', () => {
    expect(formatPeriodLabel('2025-Q1', 'quarter')).toBe('25Q1');
    expect(formatPeriodLabel('2026-Q4', 'quarter')).toBe('26Q4');
  });
  it('year: YYYY 그대로', () => {
    expect(formatPeriodLabel('2025', 'year')).toBe('2025');
  });
});

describe('attachPowertrains', () => {
  it('매핑 있으면 PT 부착', () => {
    const rows = [row({ model: 'Wagoneer S', units: 100 })];
    const map = [ptRow('Wagoneer S', 'EV')];
    expect(attachPowertrains(rows, map)[0].resolved_powertrain).toBe('EV');
  });
  it('매핑 없으면 null', () => {
    expect(
      attachPowertrains([row({ model: 'NoMap', units: 100 })], [])[0].resolved_powertrain
    ).toBeNull();
  });
  it('valid_to 적용', () => {
    const rows = [row({ period: '2025-Q2', model: 'Charger', units: 100 })];
    const map = [
      ptRow('Charger', 'ICE', { valid_from: '2021-01-01', valid_to: '2024-12-31' }),
      ptRow('Charger', 'EV', { valid_from: '2025-01-01' }),
    ];
    expect(attachPowertrains(rows, map)[0].resolved_powertrain).toBe('EV');
  });
});

describe('aggregateQuarterlySeries', () => {
  it('합계(Total) 행 제외 + 분기 합산 + YoY', () => {
    const rows = withPt([
      row({ period: '2024-Q1', brand: 'Jeep', model: 'X', units: 1000 }),
      row({ period: '2024-Q1', brand: 'Ram', model: 'Y', units: 500 }),
      // 합계 행 (포함되면 안 됨)
      row({ period: '2024-Q1', brand: 'Total', model: 'Total', units: 1500 }),
      row({ period: '2024-Q1', brand: 'Jeep', model: 'Total', units: 1000 }),
      row({ period: '2025-Q1', brand: 'Jeep', model: 'X', units: 1500 }),
      row({ period: '2025-Q1', brand: 'Ram', model: 'Y', units: 1500 }),
    ]);
    const out = aggregateQuarterlySeries(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ period: '2024-Q1', sales: 1500 });
    expect(out[1]).toMatchObject({ period: '2025-Q1', sales: 3000 });
    expect(out[1].yoy_pct).toBeCloseTo(100);
    expect(out[1].period_label).toBe('25Q1');
  });
  it('전년 동기 sales < MIN_YOY_PREV_SALES → YoY null', () => {
    const rows = withPt([
      row({ period: '2024-Q1', model: 'X', units: MIN_YOY_PREV_SALES - 1 }),
      row({ period: '2025-Q1', model: 'X', units: 1000 }),
    ]);
    expect(aggregateQuarterlySeries(rows)[1].yoy_pct).toBeNull();
  });
});

describe('aggregateAnnualSeries', () => {
  it('연 단위 합산 + YoY (분기 SUM)', () => {
    const rows: StellantisNaSaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let q = 1; q <= 4; q++) {
        rows.push(row({ period: `${y}-Q${q}`, brand: 'Jeep', model: 'X', units: 100 }));
      }
    }
    const out = aggregateAnnualSeries(withPt(rows));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ period: '2024', period_label: '2024', sales: 400 });
    expect(out[1]).toMatchObject({ period: '2025', sales: 400, yoy_pct: 0 });
  });
});

describe('aggregateKpi', () => {
  it('latestPeriod=2025-Q4 (완료 연도) → 2025 실적 + 2026 YTD(대기)', () => {
    const rows: StellantisNaSaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let q = 1; q <= 4; q++) {
        rows.push(row({ period: `${y}-Q${q}`, brand: 'Jeep', model: 'Wrangler', units: 100 }));
        if (y === 2025 && q >= 3) {
          rows.push(row({ period: `${y}-Q${q}`, brand: 'Jeep', model: 'Wagoneer S', units: 50 }));
        }
      }
    }
    // attachPowertrains 효과 시뮬레이션 — Wagoneer S만 EV.
    const ptMap = [ptRow('Wagoneer S', 'EV')];
    const withPtMapped = attachPowertrains(rows, ptMap);
    const out = aggregateKpi(withPtMapped);
    // 2025 = Wrangler 400 + Wagoneer S 100 = 500
    expect(out.latestYearLabel).toBe('2025년 실적');
    expect(out.latestYearSales).toBe(500);
    expect(out.prevYearLabel).toBe('2024년 실적');
    expect(out.prevYearSales).toBe(400);
    expect(out.yoyPct).toBeCloseTo(25);
    // 2026 데이터 없음
    expect(out.ytdLabel).toBe('2026 YTD (대기)');
    expect(out.ytdCurrent).toBe(0);
    expect(out.ytdYoyPct).toBeNull();
    // EV 비중 = 100 / 500 = 20%
    expect(out.evRatio).toBeCloseTo(20);
    expect(out.latestPeriod).toBe('25Q4');
  });

  it('latestPeriod=2026-Q2 (진행 중) → 2025 실적 + 2026 YTD(Q1~Q2)', () => {
    const rows: StellantisNaSaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let q = 1; q <= 4; q++) {
        rows.push(row({ period: `${y}-Q${q}`, model: 'X', units: 100 }));
      }
    }
    for (let q = 1; q <= 2; q++) {
      rows.push(row({ period: `2026-Q${q}`, model: 'X', units: 150 }));
    }
    const out = aggregateKpi(withPt(rows));
    expect(out.latestYearLabel).toBe('2025년 실적');
    expect(out.latestYearSales).toBe(400);
    expect(out.ytdLabel).toBe('2026 YTD (Q1~Q2)');
    expect(out.ytdCurrent).toBe(300); // 150 × 2
    expect(out.ytdPrevLabel).toBe('2025 Q1~Q2');
    expect(out.ytdPrev).toBe(200); // 100 × 2
    expect(out.ytdYoyPct).toBeCloseTo(50);
  });

  it('latestPeriod=2026-Q1 (한 분기만 진행) → Q1 라벨', () => {
    const rows: StellantisNaSaleRow[] = [];
    for (let q = 1; q <= 4; q++) {
      rows.push(row({ period: `2024-Q${q}`, model: 'X', units: 100 }));
      rows.push(row({ period: `2025-Q${q}`, model: 'X', units: 100 }));
    }
    rows.push(row({ period: '2026-Q1', model: 'X', units: 200 }));
    const out = aggregateKpi(withPt(rows));
    expect(out.ytdLabel).toBe('2026 YTD (Q1)');
    expect(out.ytdCurrent).toBe(200);
    expect(out.ytdPrev).toBe(100);
    expect(out.ytdYoyPct).toBeCloseTo(100);
  });

  it('데이터 0행 → 모두 0/null', () => {
    const out = aggregateKpi([]);
    expect(out.latestYearSales).toBe(0);
    expect(out.yoyPct).toBeNull();
    expect(out.latestPeriod).toBe('');
  });
});

describe('aggregateTopModels', () => {
  it('완료 연도(2025) vs 직전 연도(2024) + brand 필터', () => {
    const rows: StellantisNaSaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let q = 1; q <= 4; q++) {
        rows.push(
          row({ period: `${y}-Q${q}`, brand: 'Jeep', model: 'A', units: 100 * (y - 2023) })
        );
        rows.push(
          row({ period: `${y}-Q${q}`, brand: 'Jeep', model: 'B', units: 200 * (y - 2023) })
        );
        rows.push(row({ period: `${y}-Q${q}`, brand: 'Ram', model: 'C', units: 50 }));
      }
    }
    // 전체
    const all = aggregateTopModels(withPt(rows), 3);
    expect(all.rows[0]).toMatchObject({ model: 'B', salesLatestPeriod: 1600 });
    expect(all.rows[1]).toMatchObject({ model: 'A', salesLatestPeriod: 800 });
    expect(all.rows[2]).toMatchObject({ model: 'C', salesLatestPeriod: 200 });

    // Jeep filter
    const jeep = aggregateTopModels(withPt(rows), 5, 'Jeep');
    expect(jeep.rows).toHaveLength(2); // A, B만
    expect(jeep.totals.latestPeriod).toBe(2400); // 800 + 1600

    // Ram filter
    const ram = aggregateTopModels(withPt(rows), 5, 'Ram');
    expect(ram.rows).toHaveLength(1);
    expect(ram.rows[0]).toMatchObject({ model: 'C', salesLatestPeriod: 200 });
  });

  it('진행 연도(2026) YTD 합산', () => {
    const rows: StellantisNaSaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let q = 1; q <= 4; q++) {
        rows.push(row({ period: `${y}-Q${q}`, model: 'A', units: 100 }));
      }
    }
    rows.push(row({ period: '2026-Q1', model: 'A', units: 150 }));
    const out = aggregateTopModels(withPt(rows), 1);
    expect(out.rows[0]).toMatchObject({
      model: 'A',
      salesLatestPeriod: 400,
      salesPrevPeriod: 400,
      ytdSales: 150,
    });
    expect(out.totals).toEqual({ latestPeriod: 400, prevPeriod: 400, ytd: 150, ytdPrev: 100 });
  });

  it('합계 행 제외 — totals는 모델 SUM만', () => {
    const rows = withPt([
      row({ period: '2025-Q1', brand: 'Jeep', model: 'A', units: 100 }),
      row({ period: '2025-Q1', brand: 'Jeep', model: 'B', units: 200 }),
      // 합계 행 (계산에서 제외돼야)
      row({ period: '2025-Q1', brand: 'Jeep', model: 'Total', units: 300 }),
      row({ period: '2025-Q1', brand: 'Total', model: 'Total', units: 300 }),
      row({ period: '2025-Q4', brand: 'Jeep', model: 'A', units: 100 }),
    ]);
    const out = aggregateTopModels(rows, 5);
    // latestYear=2025 (Q4 있으므로 완료 연도) 합계 = A 200 + B 200 = 400
    expect(out.totals.latestPeriod).toBe(400);
  });
});

describe('aggregateQuarterlyBrandStack / aggregateAnnualBrandStack', () => {
  it('분기별 brand stacked — Total 행 제외', () => {
    const rows = withPt([
      row({ period: '2025-Q1', brand: 'Jeep', model: 'A', units: 100 }),
      row({ period: '2025-Q1', brand: 'Jeep', model: 'B', units: 200 }),
      row({ period: '2025-Q1', brand: 'Ram', model: 'C', units: 50 }),
      // Total은 제외
      row({ period: '2025-Q1', brand: 'Jeep', model: 'Total', units: 300 }),
      row({ period: '2025-Q1', brand: 'Total', model: 'Total', units: 350 }),
    ]);
    const out = aggregateQuarterlyBrandStack(rows);
    expect(out).toHaveLength(1);
    expect(out[0].period).toBe('2025-Q1');
    expect(out[0].brands.Jeep).toBe(300);
    expect(out[0].brands.Ram).toBe(50);
    expect(out[0].brands.Chrysler).toBe(0);
    expect(out[0].total).toBe(350);
  });

  it('연도별 brand stacked — 분기 SUM', () => {
    const rows: StellantisNaSaleRow[] = [];
    for (let q = 1; q <= 4; q++) {
      rows.push(row({ period: `2025-Q${q}`, brand: 'Jeep', model: 'A', units: 100 }));
      rows.push(row({ period: `2025-Q${q}`, brand: 'Ram', model: 'C', units: 50 }));
    }
    const out = aggregateAnnualBrandStack(withPt(rows));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ period: '2025', period_label: '2025' });
    expect(out[0].brands.Jeep).toBe(400);
    expect(out[0].brands.Ram).toBe(200);
    expect(out[0].total).toBe(600);
  });

  it('sortBrandsByTotal — 합계 큰 순', () => {
    const points = [
      {
        period: '2025-Q1',
        period_label: '25Q1',
        brands: { Jeep: 100, Ram: 500, Chrysler: 200, Dodge: 0, Fiat: 0, 'Alfa Romeo': 0 },
        total: 800,
      },
    ];
    const sorted = sortBrandsByTotal(points);
    expect(sorted[0]).toBe('Ram');
    expect(sorted[1]).toBe('Chrysler');
    expect(sorted[2]).toBe('Jeep');
  });

  it('STELLANTIS_NA_BRANDS 6개 확인', () => {
    expect(STELLANTIS_NA_BRANDS).toEqual([
      'Jeep',
      'Ram',
      'Chrysler',
      'Dodge',
      'Fiat',
      'Alfa Romeo',
    ]);
  });
});

describe('aggregatePtMixQuarterly / aggregatePtMixAnnual', () => {
  it('분기 PT mix — Unknown(미매핑)', () => {
    const rows = withPt([
      row({ period: '2025-Q1', model: 'A', units: 100 }), // null
      row({ period: '2025-Q1', model: 'B', units: 50 }), // null
      row({ period: '2025-Q1', model: 'Total', units: 150 }), // 합계 — 제외
    ]);
    const out = aggregatePtMixQuarterly(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ICE: 0, EV: 0, Unknown: 150, total: 150 });
  });

  it('PT 매핑 적용 후 연 합산', () => {
    const baseRows: StellantisNaSaleRow[] = [];
    for (let q = 1; q <= 4; q++) {
      baseRows.push(row({ period: `2025-Q${q}`, model: 'Wagoneer S', units: 50 })); // EV
      baseRows.push(row({ period: `2025-Q${q}`, model: 'Wrangler 4xe', units: 100 })); // PHEV
      baseRows.push(row({ period: `2025-Q${q}`, model: 'Compass', units: 200 })); // 미매핑 (Unknown)
    }
    const ptMap = [ptRow('Wagoneer S', 'EV'), ptRow('Wrangler 4xe', 'PHEV')];
    const mapped = attachPowertrains(baseRows, ptMap);
    const out = aggregatePtMixAnnual(mapped);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      period: '2025',
      EV: 200,
      PHEV: 400,
      Unknown: 800,
      total: 1400,
    });
  });
});
