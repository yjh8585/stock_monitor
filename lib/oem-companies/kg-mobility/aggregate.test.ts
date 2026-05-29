/**
 * KG모빌리티 aggregate.ts 단위 테스트 — pure 함수, mocking 없음.
 * fixture는 각 테스트 안에 inline.
 */
import { describe, expect, it } from 'vitest';
import type { CompanySaleRow, CompanySaleRowWithPt, VehiclePowertrainMapRow } from '@/lib/types';
import {
  aggregateAnnualSeries,
  aggregateKgRegionSeries,
  aggregateKgRegionSeriesAnnual,
  aggregateKpi,
  aggregateMonthlySeries,
  aggregatePtMix,
  aggregatePtMixAnnual,
  aggregateTopModels,
  attachPowertrains,
  formatPeriodLabel,
  MIN_YOY_PREV_SALES,
} from './aggregate';

function row(opts: {
  period?: string;
  region?: string;
  model: string;
  type?: string;
  pt?: CompanySaleRow['powertrain'];
  units: number;
  periodType?: CompanySaleRow['period_type'];
}): CompanySaleRow {
  return {
    period_type: opts.periodType ?? 'month',
    year_period: opts.period ?? '2025-01',
    region: opts.region ?? '내수',
    vehicle_model: opts.model,
    vehicle_type: opts.type ?? 'SUV',
    powertrain: opts.pt ?? null,
    sales_units: opts.units,
    source_url: null,
  };
}

function ptRow(
  model: string,
  pt: VehiclePowertrainMapRow['powertrain'],
  opts: Partial<VehiclePowertrainMapRow> = {}
): VehiclePowertrainMapRow {
  return {
    company_slug: 'kg-mobility',
    vehicle_model: model,
    powertrain: pt,
    valid_from: opts.valid_from ?? '2021-01-01',
    valid_to: opts.valid_to ?? null,
    source_note: opts.source_note ?? null,
  };
}

function withPt(rows: CompanySaleRow[]): CompanySaleRowWithPt[] {
  return rows.map((r) => ({ ...r, resolved_powertrain: r.powertrain }));
}

describe('formatPeriodLabel', () => {
  it('month: YYYY-MM → YY.MM', () => {
    expect(formatPeriodLabel('2025-04', 'month')).toBe('25.04');
  });
  it('quarter: YYYY-Q1 → YYYYQ1', () => {
    expect(formatPeriodLabel('2025-Q1', 'quarter')).toBe('2025Q1');
  });
  it('annual: YYYY 그대로', () => {
    expect(formatPeriodLabel('2025', 'annual')).toBe('2025');
  });
});

describe('attachPowertrains', () => {
  it('row.powertrain 있으면 우선', () => {
    const rows = [row({ model: '토레스', pt: 'EV', units: 100 })];
    const map = [ptRow('토레스', 'ICE')];
    expect(attachPowertrains(rows, map)[0].resolved_powertrain).toBe('EV');
  });
  it('row.powertrain 없으면 매핑 사용', () => {
    const rows = [row({ model: '토레스', units: 100 })];
    const map = [ptRow('토레스', 'ICE')];
    expect(attachPowertrains(rows, map)[0].resolved_powertrain).toBe('ICE');
  });
  it('매핑도 없으면 null', () => {
    expect(attachPowertrains([row({ model: '신모델', units: 100 })], [])[0].resolved_powertrain)
      .toBeNull();
  });
  it('valid_to 지난 매핑 fallback', () => {
    const rows = [row({ period: '2025-06', model: '토레스', units: 100 })];
    const map = [
      ptRow('토레스', 'ICE', { valid_from: '2021-01-01', valid_to: '2024-12-31' }),
      ptRow('토레스', 'EV', { valid_from: '2025-01-01' }),
    ];
    expect(attachPowertrains(rows, map)[0].resolved_powertrain).toBe('EV');
  });
});

describe('aggregateMonthlySeries', () => {
  it('한 month 합산 (전 region 합) + YoY 계산', () => {
    const rows = withPt([
      row({ period: '2024-01', region: '내수', model: 'X', units: 1000 }),
      row({ period: '2024-01', region: '수출', model: 'X', units: 500 }),
      row({ period: '2025-01', region: '내수', model: 'X', units: 1500 }),
      row({ period: '2025-01', region: '수출', model: 'X', units: 1500 }),
    ]);
    const out = aggregateMonthlySeries(rows);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ period: '2025-01', sales: 3000 });
    expect(out[1].yoy_pct).toBeCloseTo(100);
  });
  it('전년 sales < MIN_YOY_PREV_SALES → YoY null', () => {
    const rows = withPt([
      row({ period: '2024-01', model: 'X', units: MIN_YOY_PREV_SALES - 1 }),
      row({ period: '2025-01', model: 'X', units: 1000 }),
    ]);
    expect(aggregateMonthlySeries(rows)[1].yoy_pct).toBeNull();
  });
});

describe('aggregateAnnualSeries', () => {
  it('연 단위 합산 + YoY', () => {
    const rows: CompanySaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        rows.push(
          row({ period: `${y}-${String(m).padStart(2, '0')}`, model: 'X', units: 100 })
        );
      }
    }
    const out = aggregateAnnualSeries(withPt(rows));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ period: '2024', period_label: '2024', sales: 1200 });
    expect(out[1]).toMatchObject({ period: '2025', sales: 1200, yoy_pct: 0 });
  });
});

describe('aggregateKpi', () => {
  it('latestPeriod=2025-12 (완료 연도) → 2025 실적 + 2026 YTD(대기)', () => {
    const rows: CompanySaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        rows.push(row({ period: `${y}-${String(m).padStart(2, '0')}`, model: 'X', pt: 'ICE', units: 100 }));
        if (y === 2025 && m >= 7) {
          rows.push(
            row({ period: `${y}-${String(m).padStart(2, '0')}`, model: 'EVX', pt: 'EV', units: 50 })
          );
        }
      }
    }
    const out = aggregateKpi(withPt(rows));
    // 2025 = ICE 1200 + EV 6*50 = 1500
    expect(out.latestYearLabel).toBe('2025년 실적');
    expect(out.latestYearSales).toBe(1500);
    expect(out.prevYearLabel).toBe('2024년 실적');
    expect(out.prevYearSales).toBe(1200);
    expect(out.yoyPct).toBeCloseTo(25);
    // 2026 데이터 없음
    expect(out.ytdLabel).toBe('2026 YTD (대기)');
    expect(out.ytdCurrent).toBe(0);
    expect(out.ytdYoyPct).toBeNull();
    // EV 비중 = 300 / 1500 = 20%
    expect(out.evRatio).toBeCloseTo(20);
    expect(out.latestPeriod).toBe('2025-12');
  });

  it('latestPeriod=2026-04 (진행 중) → 2025 실적 + 2026 YTD(1~4월)', () => {
    const rows: CompanySaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        rows.push(row({ period: `${y}-${String(m).padStart(2, '0')}`, model: 'X', units: 100 }));
      }
    }
    for (let m = 1; m <= 4; m++) {
      rows.push(row({ period: `2026-${String(m).padStart(2, '0')}`, model: 'X', units: 150 }));
    }
    const out = aggregateKpi(withPt(rows));
    expect(out.latestYearLabel).toBe('2025년 실적');
    expect(out.latestYearSales).toBe(1200);
    expect(out.ytdLabel).toBe('2026 YTD (1~4월)');
    expect(out.ytdCurrent).toBe(600); // 150 × 4
    expect(out.ytdPrevLabel).toBe('2025 1~4월');
    expect(out.ytdPrev).toBe(400); // 100 × 4
    expect(out.ytdYoyPct).toBeCloseTo(50);
  });

  it('데이터 0행 → 모두 0 또는 null', () => {
    const out = aggregateKpi([]);
    expect(out.latestYearSales).toBe(0);
    expect(out.yoyPct).toBeNull();
    expect(out.latestPeriod).toBe('');
  });
});

describe('aggregateTopModels', () => {
  it('완료 연도(2025) vs 직전 연도(2024) 기준 TOP + totals + ytdSales=0', () => {
    const rows: CompanySaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        rows.push(row({ period: `${y}-${String(m).padStart(2, '0')}`, model: 'A', units: 100 * (y - 2023) }));
        rows.push(row({ period: `${y}-${String(m).padStart(2, '0')}`, model: 'B', units: 200 * (y - 2023) }));
      }
    }
    const out = aggregateTopModels(withPt(rows), 2);
    expect(out.rows[0]).toMatchObject({ model: 'B', salesLatestPeriod: 4800, salesPrevPeriod: 2400, ytdSales: 0 });
    expect(out.rows[1]).toMatchObject({ model: 'A', salesLatestPeriod: 2400, ytdSales: 0 });
    expect(out.rows[0].yoyPct).toBeCloseTo(100);
    // totals: A+B both years (A=100/year×12=1200/2400, B=200×12=2400/4800)
    expect(out.totals.latestPeriod).toBe(4800 + 2400); // 2025
    expect(out.totals.prevPeriod).toBe(2400 + 1200); // 2024
    expect(out.totals.ytd).toBe(0);
  });

  it('진행 연도(2026) YTD 합산 + totals.ytd', () => {
    const rows: CompanySaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        rows.push(row({ period: `${y}-${String(m).padStart(2, '0')}`, model: 'A', units: 100 }));
      }
    }
    for (let m = 1; m <= 4; m++) {
      rows.push(row({ period: `2026-${String(m).padStart(2, '0')}`, model: 'A', units: 150 }));
    }
    const out = aggregateTopModels(withPt(rows), 1);
    expect(out.rows[0]).toMatchObject({
      model: 'A',
      salesLatestPeriod: 1200,
      salesPrevPeriod: 1200,
      ytdSales: 600,
    });
    expect(out.totals).toEqual({ latestPeriod: 1200, prevPeriod: 1200, ytd: 600, ytdPrev: 400 });
  });

  it('region 필터 = 내수 적용 시 totals도 내수만 합산', () => {
    const rows = withPt([
      row({ period: '2025-06', region: '내수', model: 'A', units: 100 }),
      row({ period: '2025-06', region: '수출', model: 'A', units: 50 }),
      row({ period: '2025-12', region: '내수', model: 'A', units: 100 }),
    ]);
    const out = aggregateTopModels(rows, 5, '내수');
    expect(out.totals.latestPeriod).toBe(200); // 수출 50 제외
  });
});

describe('aggregatePtMix / aggregatePtMixAnnual', () => {
  it('월별 PT 합산 + Unknown', () => {
    const rows = withPt([
      row({ period: '2025-01', model: 'A', pt: 'ICE', units: 100 }),
      row({ period: '2025-01', model: 'B', pt: 'EV', units: 50 }),
      row({ period: '2025-01', model: 'C', pt: null, units: 30 }),
    ]);
    const out = aggregatePtMix(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ICE: 100, EV: 50, Unknown: 30, total: 180 });
  });

  it('연간 PT 합산 — 같은 연도 다른 월 통합', () => {
    const rows = withPt([
      row({ period: '2025-01', model: 'A', pt: 'ICE', units: 100 }),
      row({ period: '2025-02', model: 'A', pt: 'ICE', units: 100 }),
      row({ period: '2025-06', model: 'B', pt: 'EV', units: 50 }),
      row({ period: '2024-01', model: 'A', pt: 'ICE', units: 80 }),
    ]);
    const out = aggregatePtMixAnnual(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ period: '2024', ICE: 80, total: 80 });
    expect(out[1]).toMatchObject({ period: '2025', ICE: 200, EV: 50, total: 250 });
  });
});

describe('aggregateKgRegionSeries / Annual', () => {
  it('월별 — 내수/수출 분리', () => {
    const rows = withPt([
      row({ period: '2025-01', region: '내수', model: 'A', units: 1000 }),
      row({ period: '2025-01', region: '수출', model: 'A', units: 500 }),
      row({ period: '2025-01', region: 'CKD', model: 'B', units: 200 }),
    ]);
    const out = aggregateKgRegionSeries(rows);
    expect(out[0]).toMatchObject({ domestic: 1200, export: 500, total: 1700 });
  });
  it('연간 — 같은 연도 합산', () => {
    const rows = withPt([
      row({ period: '2025-01', region: '내수', model: 'A', units: 1000 }),
      row({ period: '2025-02', region: '내수', model: 'A', units: 800 }),
      row({ period: '2025-06', region: '수출', model: 'A', units: 500 }),
      row({ period: '2024-01', region: '내수', model: 'A', units: 600 }),
    ]);
    const out = aggregateKgRegionSeriesAnnual(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ period: '2024', domestic: 600, export: 0 });
    expect(out[1]).toMatchObject({ period: '2025', domestic: 1800, export: 500, total: 2300 });
  });
});
