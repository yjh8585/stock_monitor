/**
 * 현대차 aggregate.ts 단위 테스트 — pure 함수.
 * KG(kg-mobility/aggregate.test.ts) 동일 패턴 + 공장별 함수 추가 테스트.
 */
import { describe, expect, it } from 'vitest';
import type {
  CompanySaleRowWithPt,
  HyundaiExportRegionRow,
  HyundaiQuarterlyEarningsRow,
  HyundaiRetailSaleRow,
  HyundaiSaleRow,
  VehiclePowertrainMapRow,
} from '@/lib/types';
import {
  aggregateAnnualSeries,
  aggregateHyundaiAnnualEarnings,
  aggregateHyundaiEuRetail,
  aggregateHyundaiExportRegions,
  aggregateHyundaiFactoryMix,
  aggregateHyundaiFactoryMixAnnual,
  aggregateHyundaiFactoryModelMix,
  aggregateHyundaiQuarterlyEarnings,
  aggregateHyundaiQuarterlyRegions,
  aggregateHyundaiRetailWholesale,
  aggregateHyundaiUsMarketShare,
  aggregateHyundaiUsRetailTopModels,
  aggregateKpi,
  aggregateMonthlySeries,
  aggregatePtMix,
  aggregateTopModels,
  attachPowertrains,
  listFactoryCodes,
  listFactoryModelMixYears,
  normalizeProgramCode,
  summarizeIRComparison,
} from './aggregate';

function row(opts: {
  period?: string;
  region?: string;
  factory?: string;
  model: string;
  type?: string;
  pt?: HyundaiSaleRow['powertrain'];
  units: number;
}): HyundaiSaleRow {
  return {
    period_type: 'month',
    year_period: opts.period ?? '2025-01',
    region: opts.region ?? '내수',
    factory: opts.factory ?? '',
    vehicle_model: opts.model,
    vehicle_type: opts.type ?? 'SUV',
    powertrain: opts.pt ?? null,
    sales_units: opts.units,
    source_url: null,
  };
}

function ptRow(model: string, pt: VehiclePowertrainMapRow['powertrain']): VehiclePowertrainMapRow {
  return {
    company_slug: 'hyundai',
    vehicle_model: model,
    powertrain: pt,
    valid_from: '2021-01-01',
    valid_to: null,
    source_note: null,
  };
}

function withPt(rows: HyundaiSaleRow[]): (CompanySaleRowWithPt & { factory: string })[] {
  return rows.map((r) => ({ ...r, resolved_powertrain: r.powertrain }));
}

describe('aggregateKpi (factory 무관 — 한국+해외 공장 도매 합산)', () => {
  it('factory<>"" 행도 KPI/시계열 합계에 포함 (회사 전체 도매)', () => {
    const rows = withPt([
      row({ period: '2025-01', model: 'A', units: 1000 }),
      row({ period: '2025-01', factory: '앨라배마', model: 'A', units: 500 }),
    ]);
    const out = aggregateKpi(rows);
    const ms = aggregateMonthlySeries(rows);
    expect(ms).toHaveLength(1);
    expect(ms[0].sales).toBe(1500); // 한국 공장 + 해외 공장 합산
    expect(out.latestPeriod).toBe('2025-01');
  });

  it('latestPeriod=2025-12 → 2025 실적 + 2026 YTD(대기)', () => {
    const rows: HyundaiSaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        rows.push(row({ period: `${y}-${String(m).padStart(2, '0')}`, model: 'A', units: 100 }));
      }
    }
    const out = aggregateKpi(withPt(rows));
    expect(out.latestYearLabel).toBe('2025년 실적');
    expect(out.latestYearSales).toBe(1200);
    expect(out.prevYearSales).toBe(1200);
    expect(out.ytdLabel).toBe('2026 YTD (대기)');
  });
});

describe('aggregateAnnualSeries', () => {
  it('연 단위 합산 (한국+해외 공장 모두 포함)', () => {
    const rows = withPt([
      row({ period: '2024-01', model: 'A', units: 100 }),
      row({ period: '2024-06', model: 'A', units: 200 }),
      row({ period: '2025-03', model: 'A', units: 400 }),
      row({ period: '2025-03', factory: '베이징', model: 'A', units: 1000 }),
    ]);
    const out = aggregateAnnualSeries(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ period: '2024', sales: 300 });
    expect(out[1]).toMatchObject({ period: '2025', sales: 1400 }); // 400 + 1000
  });
});

describe('aggregateTopModels (factory 무관 — 회사 전체 합산)', () => {
  it('공장별 행도 같은 model로 합산 + totals', () => {
    const rows: HyundaiSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      rows.push(row({ period: `2025-${String(m).padStart(2, '0')}`, model: '그랜저', units: 100 }));
      rows.push(
        row({
          period: `2025-${String(m).padStart(2, '0')}`,
          factory: '체코',
          model: '그랜저',
          units: 999,
        })
      );
    }
    const out = aggregateTopModels(withPt(rows), 5);
    expect(out.rows[0]).toMatchObject({ model: '그랜저', salesLatestPeriod: 1200 + 11988 });
    expect(out.totals.latestPeriod).toBe(1200 + 11988);
  });
});

describe('normalizeProgramCode (#10)', () => {
  it('CN7 region/PT 접미 제거 + Avante→Elantra 글로벌명 통일', () => {
    expect(normalizeProgramCode('Avante (CN7)')).toBe('Elantra (CN7)');
    expect(normalizeProgramCode('Avante (CN7c)')).toBe('Elantra (CN7)');
    expect(normalizeProgramCode('Avante (CN7e)')).toBe('Elantra (CN7)');
    expect(normalizeProgramCode('Avante (CN7 HEV)')).toBe('Elantra (CN7)');
    expect(normalizeProgramCode('Avante (CN7 EV)')).toBe('Elantra (CN7)');
  });

  it('NX4 / OS / SX2 등 다른 코드 패턴', () => {
    expect(normalizeProgramCode('Tucson (NX4)')).toBe('Tucson (NX4)');
    expect(normalizeProgramCode('Tucson (NX4a)')).toBe('Tucson (NX4)');
    expect(normalizeProgramCode('Tucson (NX4 PHEV)')).toBe('Tucson (NX4)');
    expect(normalizeProgramCode('Kona (SX2)')).toBe('Kona (SX2)');
    expect(normalizeProgramCode('Kona (OS)')).toBe('Kona (OS)'); // OS는 숫자 없음 → 매칭 안 됨, 원본
  });

  it('패턴 매칭 안 되면 원본 그대로', () => {
    expect(normalizeProgramCode('아이오닉5')).toBe('아이오닉5');
    expect(normalizeProgramCode('Tucson')).toBe('Tucson');
    expect(normalizeProgramCode('Stargazer (KU1)')).toBe('Stargazer (KU1)');
  });
});

describe('aggregateTopModels — 차종 통일 (#10)', () => {
  it("'전체'(all) 모드에서 CN7/CN7c/CN7 HEV 통합", () => {
    const rows: HyundaiSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const p = `2025-${String(m).padStart(2, '0')}`;
      rows.push(row({ period: p, model: 'Avante (CN7)', units: 100 }));
      rows.push(row({ period: p, model: 'Avante (CN7c)', units: 50 }));
      rows.push(row({ period: p, model: 'Avante (CN7 HEV)', units: 30 }));
    }
    const out = aggregateTopModels(withPt(rows), 5, 'all');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].model).toBe('Elantra (CN7)');
    expect(out.rows[0].salesLatestPeriod).toBe(12 * (100 + 50 + 30));
  });

  it("특정 공장(예: 'HMI') 선택 시 원본 모델명 유지 (#10)", () => {
    const rows: HyundaiSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const p = `2025-${String(m).padStart(2, '0')}`;
      rows.push(
        row({ period: p, factory: 'HMI', region: 'India', model: 'Creta (SU2i)', units: 100 })
      );
      rows.push(
        row({ period: p, factory: 'HMI', region: 'India', model: 'Creta (SU2)', units: 50 })
      );
    }
    const out = aggregateTopModels(withPt(rows), 5, 'HMI');
    // HMI 선택 시 통일 안 함 → 별도 모델로 분리
    expect(out.rows.length).toBe(2);
    const codes = out.rows.map((r) => r.model).sort();
    expect(codes).toEqual(['Creta (SU2)', 'Creta (SU2i)']);
  });

  it('factory 코드 필터 — 해외 공장만 합산', () => {
    const rows: HyundaiSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const p = `2025-${String(m).padStart(2, '0')}`;
      rows.push(row({ period: p, factory: 'HMMA', region: 'US', model: 'Tucson', units: 500 }));
      rows.push(row({ period: p, factory: 'HMI', region: 'India', model: 'Creta', units: 300 }));
      rows.push(row({ period: p, region: '내수', model: 'Sonata', units: 999 })); // 한국 공장
    }
    const out = aggregateTopModels(withPt(rows), 5, 'HMMA');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].model).toBe('Tucson');
    expect(out.rows[0].salesLatestPeriod).toBe(12 * 500);
  });
});

describe('listFactoryCodes / listFactoryModelMixYears', () => {
  it('해외 공장 코드 + 연도 목록 추출', () => {
    const rows: HyundaiSaleRow[] = [
      row({ period: '2024-01', factory: 'HMI', region: 'India', model: 'A', units: 100 }),
      row({ period: '2025-06', factory: 'HMMA', region: 'US', model: 'B', units: 100 }),
      row({ period: '2025-12', region: '내수', model: 'C', units: 100 }), // factory=''
    ];
    const withPtRows = withPt(rows);
    expect(listFactoryCodes(withPtRows)).toEqual(['HMI', 'HMMA']);
    expect(listFactoryModelMixYears(withPtRows)).toEqual(['2024', '2025']);
  });
});

describe('aggregateHyundaiUsRetailTopModels (#11)', () => {
  it('US 행 중 Total/Industry/MarketShare 제외 → TOP10', () => {
    const rows: HyundaiRetailSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const period = `2025-${String(m).padStart(2, '0')}`;
      rows.push({
        period_type: 'month',
        year_period: period,
        region: 'US',
        vehicle_type: 'PC',
        vehicle_model: 'Sonata',
        retail_units: 3_000,
        market_share: null,
        industry_total: null,
      });
      rows.push({
        period_type: 'month',
        year_period: period,
        region: 'US',
        vehicle_type: '',
        vehicle_model: 'Total',
        retail_units: 60_000,
        market_share: null,
        industry_total: null,
      });
      rows.push({
        period_type: 'month',
        year_period: period,
        region: 'US',
        vehicle_type: '',
        vehicle_model: 'MarketShare',
        retail_units: null,
        market_share: 0.045,
        industry_total: null,
      });
    }
    const out = aggregateHyundaiUsRetailTopModels(rows);
    expect(out).toHaveLength(1);
    expect(out[0].model).toBe('Sonata');
    expect(out[0].retailLatest).toBe(36_000);
  });

  it('EU는 제외', () => {
    const rows: HyundaiRetailSaleRow[] = [
      {
        period_type: 'month',
        year_period: '2025-01',
        region: 'EU',
        vehicle_type: 'PC',
        vehicle_model: 'Tucson',
        retail_units: 5_000,
        market_share: null,
        industry_total: null,
      },
    ];
    expect(aggregateHyundaiUsRetailTopModels(rows)).toHaveLength(0);
  });
});

describe('aggregateHyundaiFactoryMix / Annual', () => {
  it('월별 공장별 합산 — factory="" 제외', () => {
    const rows = withPt([
      row({ period: '2025-01', factory: '앨라배마', model: 'A', units: 1000 }),
      row({ period: '2025-01', factory: '베이징', model: 'A', units: 500 }),
      row({ period: '2025-01', model: 'A', units: 100 }), // factory='', 제외
    ]);
    const out = aggregateHyundaiFactoryMix(rows);
    expect(out).toHaveLength(1);
    expect(out[0].factories).toEqual({ 앨라배마: 1000, 베이징: 500 });
    expect(out[0].total).toBe(1500);
  });

  it('연간 공장별 합산', () => {
    const rows = withPt([
      row({ period: '2024-01', factory: '앨라배마', model: 'A', units: 100 }),
      row({ period: '2024-06', factory: '앨라배마', model: 'A', units: 200 }),
      row({ period: '2025-03', factory: '베이징', model: 'A', units: 500 }),
    ]);
    const out = aggregateHyundaiFactoryMixAnnual(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ period: '2024', factories: { 앨라배마: 300 }, total: 300 });
    expect(out[1]).toMatchObject({ period: '2025', factories: { 베이징: 500 }, total: 500 });
  });
});

describe('aggregatePtMix (factory 무관 — 회사 전체 합산)', () => {
  it('공장별 행도 PT mix에 포함', () => {
    const rows = withPt([
      row({ period: '2025-01', model: 'A', pt: 'ICE', units: 100 }),
      row({ period: '2025-01', factory: '앨라배마', model: 'A', pt: 'ICE', units: 1000 }),
    ]);
    const out = aggregatePtMix(rows);
    expect(out[0].ICE).toBe(1100);
    expect(out[0].total).toBe(1100);
  });
});

describe('attachPowertrains', () => {
  it('hyundai 매핑 → resolved_powertrain', () => {
    const rows = [row({ model: '아이오닉5', units: 100 })];
    const map = [ptRow('아이오닉5', 'EV')];
    const out = attachPowertrains(rows, map);
    expect(out[0].resolved_powertrain).toBe('EV');
    expect(out[0].factory).toBe(''); // factory 컬럼 보존
  });
});

// ============================================================
// Phase 2B — 분기별 IR 실적
// ============================================================

function earningRow(opts: {
  year: number;
  q: number;
  revenue?: number | null;
  opIncome?: number | null;
  opm?: number | null;
  globalWholesale?: number | null;
}): HyundaiQuarterlyEarningsRow {
  return {
    fiscal_year: opts.year,
    fiscal_quarter: opts.q,
    period_end_date: null,
    revenue_krw_bn: opts.revenue ?? null,
    revenue_auto_krw_bn: null,
    revenue_finance_krw_bn: null,
    revenue_other_krw_bn: null,
    operating_income_krw_bn: opts.opIncome ?? null,
    operating_margin_pct: opts.opm ?? null,
    net_income_krw_bn: null,
    ebitda_krw_bn: null,
    global_wholesale_k_units: opts.globalWholesale ?? null,
    global_retail_k_units: null,
    domestic_wholesale_k_units: null,
    overseas_wholesale_k_units: null,
    ev_k_units: null,
    hev_k_units: null,
    phev_k_units: null,
    fcev_k_units: null,
    eco_total_k_units: null,
  };
}

describe('aggregateHyundaiQuarterlyEarnings', () => {
  it('연/분기 오름차순 정렬 + opm 행 값 우선', () => {
    const rows = [
      earningRow({ year: 2025, q: 2, revenue: 100, opIncome: 10, opm: 12.5 }),
      earningRow({ year: 2024, q: 1, revenue: 80, opIncome: 8 }),
      earningRow({ year: 2025, q: 1, revenue: 90, opIncome: 9 }),
    ];
    const out = aggregateHyundaiQuarterlyEarnings(rows);
    expect(out).toHaveLength(3);
    expect(out[0].period).toBe('2024-Q1');
    expect(out[1].period).toBe('2025-Q1');
    expect(out[2].period).toBe('2025-Q2');
    expect(out[2].operating_margin_pct).toBe(12.5); // 행 opm 값 그대로
    expect(out[0].operating_margin_pct).toBe(10); // 80/8 → 10%
    expect(out[1].period_label).toBe('25Q1');
  });

  it('revenue=0 또는 NULL → opm=null', () => {
    const rows = [
      earningRow({ year: 2025, q: 1, revenue: 0, opIncome: 5 }),
      earningRow({ year: 2025, q: 2, revenue: null, opIncome: 5 }),
    ];
    const out = aggregateHyundaiQuarterlyEarnings(rows);
    expect(out[0].operating_margin_pct).toBeNull();
    expect(out[1].operating_margin_pct).toBeNull();
  });
});

// ============================================================
// Phase 2C — US/EU retail vs wholesale
// ============================================================

function retailRow(opts: {
  year: string;
  month?: number;
  region: 'US' | 'EU';
  model?: string;
  type?: string;
  units?: number | null;
  share?: number | null;
  industry?: number | null;
}): HyundaiRetailSaleRow {
  const period = opts.month ? `${opts.year}-${String(opts.month).padStart(2, '0')}` : opts.year;
  return {
    period_type: opts.month ? 'month' : 'annual',
    year_period: period,
    region: opts.region,
    vehicle_type: opts.type ?? '',
    vehicle_model: opts.model ?? 'Total',
    retail_units: opts.units ?? null,
    market_share: opts.share ?? null,
    industry_total: opts.industry ?? null,
  };
}

function irRow(opts: {
  year: string;
  regionName: string;
  units: number;
  source?: 'export-by-region' | 'ir-summary';
  periodType?: 'month' | 'annual';
}): HyundaiExportRegionRow {
  return {
    period_type: opts.periodType ?? 'annual',
    year_period: opts.year,
    source: opts.source ?? 'ir-summary',
    region_name: opts.regionName,
    sales_units: opts.units,
  };
}

describe('aggregateHyundaiRetailWholesale', () => {
  it('US 카드 — 최근 연도 retail+wholesale 모두 있을 때 비율/YoY 계산', () => {
    const retail: HyundaiRetailSaleRow[] = [];
    // 2024 monthly Total: 12개월 × 70,000 = 840,000
    for (let m = 1; m <= 12; m++) {
      retail.push(retailRow({ year: '2024', month: m, region: 'US', units: 70_000 }));
    }
    // 2025 monthly Total: 12개월 × 75,000 = 900,000
    for (let m = 1; m <= 12; m++) {
      retail.push(retailRow({ year: '2025', month: m, region: 'US', units: 75_000 }));
    }
    const ir: HyundaiExportRegionRow[] = [
      irRow({ year: '2024', regionName: '북미', units: 1_200_000 }),
      irRow({ year: '2025', regionName: '북미', units: 1_000_000 }),
      irRow({ year: '2025', regionName: '유럽', units: 600_000 }),
    ];
    const out = aggregateHyundaiRetailWholesale(retail, ir);
    expect(out.us).not.toBeNull();
    expect(out.us!.latestYear).toBe('2025');
    expect(out.us!.retailUnits).toBe(900_000);
    expect(out.us!.wholesaleUnits).toBe(1_000_000);
    expect(out.us!.retailOverWholesalePct).toBe(90);
    // YoY: (900,000 - 840,000) / 840,000 = 7.142...%
    expect(out.us!.retailYoyPct).toBeCloseTo(7.142857, 3);
    expect(out.us!.prevYear).toBe('2024');
  });

  it('EU 데이터 없으면 null', () => {
    const retail: HyundaiRetailSaleRow[] = [
      retailRow({ year: '2025', month: 1, region: 'US', units: 70_000 }),
    ];
    const ir: HyundaiExportRegionRow[] = [
      irRow({ year: '2025', regionName: '북미', units: 1_000_000 }),
    ];
    const out = aggregateHyundaiRetailWholesale(retail, ir);
    expect(out.us).not.toBeNull();
    expect(out.eu).toBeNull();
  });

  it('2023 누락 — 2022/2024 retail 있고 2024 ir-summary 있어도 2024 선택', () => {
    const retail: HyundaiRetailSaleRow[] = [
      retailRow({ year: '2022', month: 1, region: 'US', units: 50_000 }),
      retailRow({ year: '2024', month: 1, region: 'US', units: 60_000 }),
    ];
    const ir: HyundaiExportRegionRow[] = [
      irRow({ year: '2022', regionName: '북미', units: 500_000 }),
      irRow({ year: '2024', regionName: '북미', units: 800_000 }),
    ];
    const out = aggregateHyundaiRetailWholesale(retail, ir);
    expect(out.us!.latestYear).toBe('2024');
    // 2023 retail 없음 → prevRetail=0 → YoY=null
    expect(out.us!.retailYoyPct).toBeNull();
  });
});

describe('aggregateHyundaiUsMarketShare', () => {
  it('MarketShare row × 100 + Industry/Total 같은 period에 병합', () => {
    const rows: HyundaiRetailSaleRow[] = [
      retailRow({
        year: '2025',
        month: 1,
        region: 'US',
        model: 'MarketShare',
        share: 0.045,
      }),
      retailRow({
        year: '2025',
        month: 1,
        region: 'US',
        model: 'Industry',
        industry: 1_200_000,
      }),
      retailRow({ year: '2025', month: 1, region: 'US', model: 'Total', units: 54_000 }),
      retailRow({ year: '2025', month: 2, region: 'US', model: 'MarketShare', share: 0.05 }),
    ];
    const out = aggregateHyundaiUsMarketShare(rows);
    expect(out).toHaveLength(2);
    expect(out[0].period).toBe('2025-01');
    expect(out[0].market_share_pct).toBeCloseTo(4.5, 5);
    expect(out[0].industry_total).toBe(1_200_000);
    expect(out[0].hmc_retail).toBe(54_000);
    expect(out[1].market_share_pct).toBeCloseTo(5.0, 5);
    expect(out[1].industry_total).toBeNull();
  });

  it('EU 행은 제외', () => {
    const rows: HyundaiRetailSaleRow[] = [
      retailRow({ year: '2025', month: 1, region: 'EU', model: 'MarketShare', share: 0.03 }),
    ];
    const out = aggregateHyundaiUsMarketShare(rows);
    expect(out).toHaveLength(0);
  });
});

// ============================================================
// Phase 2D — 신규 #1~#12 작업 (2026-05-26)
// ============================================================

describe('aggregateTopModels — domestic 필터 (한국 공장 출하: 내수+수출)', () => {
  it('factory="" + region="내수"/"수출" 만 합산, 해외 공장 제외', () => {
    const rows: HyundaiSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      // 한국 공장 내수
      rows.push(
        row({
          period: `2025-${String(m).padStart(2, '0')}`,
          region: '내수',
          model: 'A',
          units: 100,
        })
      );
      // 한국 공장 수출
      rows.push(
        row({
          period: `2025-${String(m).padStart(2, '0')}`,
          region: '수출',
          model: 'A',
          units: 200,
        })
      );
      // 해외 공장 — domestic 모드에선 제외돼야 함
      rows.push(
        row({
          period: `2025-${String(m).padStart(2, '0')}`,
          factory: 'HMI',
          region: 'India',
          model: 'A',
          units: 999,
        })
      );
    }
    const all = aggregateTopModels(withPt(rows), 5, 'all');
    const domestic = aggregateTopModels(withPt(rows), 5, 'domestic');
    expect(all.rows[0].salesLatestPeriod).toBe(12 * (100 + 200 + 999));
    expect(domestic.rows[0].salesLatestPeriod).toBe(12 * (100 + 200));
  });
});

describe('aggregateHyundaiAnnualEarnings — 분기 합산 + 가중평균 opm', () => {
  it('4 분기 모두 있으면 완전 연간, 매출 합 + opm 가중평균', () => {
    const rows = [
      earningRow({ year: 2024, q: 1, revenue: 40_000, opIncome: 4_000 }),
      earningRow({ year: 2024, q: 2, revenue: 45_000, opIncome: 5_000 }),
      earningRow({ year: 2024, q: 3, revenue: 50_000, opIncome: 6_000 }),
      earningRow({ year: 2024, q: 4, revenue: 55_000, opIncome: 7_000 }),
    ];
    const out = aggregateHyundaiAnnualEarnings(rows);
    expect(out).toHaveLength(1);
    expect(out[0].period).toBe('2024');
    expect(out[0].is_ytd).toBe(false);
    expect(out[0].quarters_used).toBe(4);
    expect(out[0].revenue_krw_bn).toBe(190_000);
    expect(out[0].operating_income_krw_bn).toBe(22_000);
    // 22_000 / 190_000 * 100 = 11.578947...
    expect(out[0].operating_margin_pct).toBeCloseTo(11.579, 3);
  });

  it('2 분기만 있으면 YTD 라벨 + 부분 합', () => {
    const rows = [
      earningRow({ year: 2026, q: 1, revenue: 42_000, opIncome: 4_200 }),
      earningRow({ year: 2026, q: 2, revenue: 44_000, opIncome: 4_400 }),
    ];
    const out = aggregateHyundaiAnnualEarnings(rows);
    expect(out[0].period).toBe('2026 YTD');
    expect(out[0].is_ytd).toBe(true);
    expect(out[0].quarters_used).toBe(2);
    expect(out[0].revenue_krw_bn).toBe(86_000);
    expect(out[0].operating_margin_pct).toBeCloseTo(10, 5);
  });

  it('매출 NULL 분기는 합산 제외', () => {
    const rows = [
      earningRow({ year: 2024, q: 1, revenue: 40_000, opIncome: 4_000 }),
      earningRow({ year: 2024, q: 2, revenue: null, opIncome: null }),
      earningRow({ year: 2024, q: 3, revenue: 50_000, opIncome: 6_000 }),
      earningRow({ year: 2024, q: 4, revenue: 55_000, opIncome: 7_000 }),
    ];
    const out = aggregateHyundaiAnnualEarnings(rows);
    expect(out[0].quarters_used).toBe(4);
    // 매출 NULL 분기 제외 합산 (Q1+Q3+Q4)
    expect(out[0].revenue_krw_bn).toBe(40_000 + 50_000 + 55_000);
    expect(out[0].operating_income_krw_bn).toBe(4_000 + 6_000 + 7_000);
  });
});

describe('aggregateHyundaiFactoryModelMix — 모든 해외 공장 (#9)', () => {
  it('해외 공장 전체 포함 (HMMI/CKD 도 등장), factory="" 한국 공장은 제외', () => {
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
    const rows: HyundaiSaleRow[] = [];
    for (const p of months) {
      rows.push(row({ period: p, factory: 'HMI', region: 'India', model: 'Creta', units: 500 }));
      rows.push(row({ period: p, factory: 'HMMA', region: 'US', model: 'Tucson', units: 400 }));
      rows.push(
        row({ period: p, factory: 'HMMI', region: 'Indonesia', model: 'Stargazer', units: 300 })
      );
      rows.push(row({ period: p, factory: 'CKD', region: 'Other', model: 'X', units: 100 }));
      // 한국 공장 — 제외돼야 함
      rows.push(row({ period: p, region: '내수', model: 'Sonata', units: 999 }));
    }
    const out = aggregateHyundaiFactoryModelMix(withPt(rows), 6);
    const factoryCodes = out.map((f) => f.factory);
    expect(factoryCodes).toContain('HMI');
    expect(factoryCodes).toContain('HMMA');
    expect(factoryCodes).toContain('HMMI');
    expect(factoryCodes).toContain('CKD'); // #7 — 모든 해외 공장 포함
    expect(factoryCodes).not.toContain(''); // 한국 공장 제외
    // 합계 desc 정렬 (HMI=500*12=6000, HMMA=400*12=4800, HMMI=3600, CKD=1200)
    expect(factoryCodes).toEqual(['HMI', 'HMMA', 'HMMI', 'CKD']);
    expect(out[0].factoryLocation).toBe('인도 첸나이');
    expect(out[0].models.Creta).toBe(500 * 12);
  });

  it('합계 큰 공장 순으로 정렬', () => {
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
    const rows: HyundaiSaleRow[] = [];
    for (const p of months) {
      rows.push(row({ period: p, factory: 'HMMC', region: 'EU', model: 'Tucson', units: 200 }));
      rows.push(row({ period: p, factory: 'BHMC', region: 'China', model: 'Mistra', units: 1000 }));
    }
    const out = aggregateHyundaiFactoryModelMix(withPt(rows));
    expect(out.map((f) => f.factory)).toEqual(['BHMC', 'HMMC']); // BHMC가 더 큼
  });

  it('yearFilter — 지정 연도만 집계', () => {
    const rows: HyundaiSaleRow[] = [
      row({ period: '2024-06', factory: 'HMI', region: 'India', model: 'Creta', units: 1000 }),
      row({ period: '2025-06', factory: 'HMI', region: 'India', model: 'Creta', units: 500 }),
    ];
    const out2024 = aggregateHyundaiFactoryModelMix(withPt(rows), 6, '2024');
    const out2025 = aggregateHyundaiFactoryModelMix(withPt(rows), 6, '2025');
    expect(out2024[0].total).toBe(1000);
    expect(out2025[0].total).toBe(500);
  });
});

describe('aggregateHyundaiExportRegions — 2026 YTD 처리', () => {
  it('진행 중 연도(12월 미만)는 YYYY YTD 라벨 + is_ytd=true', () => {
    const exportRows: HyundaiExportRegionRow[] = [
      // 2025 완료 (12개월)
      ...Array.from({ length: 12 }, (_, i) => ({
        period_type: 'month' as const,
        year_period: `2025-${String(i + 1).padStart(2, '0')}`,
        source: 'export-by-region' as const,
        region_name: 'US',
        sales_units: 100,
      })),
      // 2026 진행 중 (1~4월)
      ...Array.from({ length: 4 }, (_, i) => ({
        period_type: 'month' as const,
        year_period: `2026-${String(i + 1).padStart(2, '0')}`,
        source: 'export-by-region' as const,
        region_name: 'US',
        sales_units: 100,
      })),
    ];
    const out = aggregateHyundaiExportRegions(exportRows, 'annual');
    expect(out).toHaveLength(2);
    expect(out[0].period).toBe('2025');
    expect(out[0].is_ytd).toBe(false);
    expect(out[0].total).toBe(1200);
    expect(out[1].period).toBe('2026 YTD');
    expect(out[1].is_ytd).toBe(true);
    expect(out[1].total).toBe(400);
  });
});

describe('summarizeIRComparison', () => {
  it('IR+DB 둘 다 있는 최근 연도 요약', () => {
    const ir: HyundaiExportRegionRow[] = [
      irRow({ year: '2024', regionName: '북미', units: 800_000 }),
      irRow({ year: '2024', regionName: '국내', units: 700_000 }),
      irRow({ year: '2025', regionName: '북미', units: 850_000 }),
      irRow({ year: '2025', regionName: '국내', units: 720_000 }),
    ];
    const dbAnnual = [
      {
        period: '2024',
        period_label: '2024',
        sales: 1_500_000,
        yoy_pct: null,
      },
      {
        period: '2025',
        period_label: '2025',
        sales: 1_570_000,
        yoy_pct: null,
      },
    ];
    const out = summarizeIRComparison(ir, dbAnnual);
    expect(out.latestYear).toBe('2025');
    expect(out.latestIrTotal).toBe(1_570_000);
    expect(out.latestDbTotal).toBe(1_570_000);
    expect(out.latestDiff).toBe(0);
  });

  it('IR 없으면 latestYear=null', () => {
    const out = summarizeIRComparison([], []);
    expect(out.latestYear).toBeNull();
    expect(out.rows).toEqual([]);
  });
});

describe('aggregateHyundaiEuRetail', () => {
  it('EU Total 월별 추이 + YoY%', () => {
    const rows: HyundaiRetailSaleRow[] = [];
    // 2024 monthly Total: 60,000
    for (let m = 1; m <= 12; m++) {
      rows.push(retailRow({ year: '2024', month: m, region: 'EU', units: 60_000 }));
    }
    // 2025 monthly Total: 66,000
    for (let m = 1; m <= 12; m++) {
      rows.push(retailRow({ year: '2025', month: m, region: 'EU', units: 66_000 }));
    }
    const out = aggregateHyundaiEuRetail(rows);
    expect(out.monthlySeries).toHaveLength(24);
    const jan2025 = out.monthlySeries.find((p) => p.period === '2025-01');
    expect(jan2025?.retail_units).toBe(66_000);
    expect(jan2025?.yoy_pct).toBeCloseTo(10, 3);
  });

  it('차종 TOP — 최근 완료 연도 기준 (Total/Industry/MarketShare 제외)', () => {
    const rows: HyundaiRetailSaleRow[] = [
      // 2025 완전 연도 (12월 데이터 있음)
      ...Array.from({ length: 12 }, (_, i) => ({
        period_type: 'month' as const,
        year_period: `2025-${String(i + 1).padStart(2, '0')}`,
        region: 'EU' as const,
        vehicle_type: 'PC',
        vehicle_model: 'Tucson',
        retail_units: 5_000,
        market_share: null,
        industry_total: null,
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        period_type: 'month' as const,
        year_period: `2025-${String(i + 1).padStart(2, '0')}`,
        region: 'EU' as const,
        vehicle_type: '',
        vehicle_model: 'Total',
        retail_units: 60_000,
        market_share: null,
        industry_total: null,
      })),
    ];
    const out = aggregateHyundaiEuRetail(rows);
    expect(out.latestYearLabel).toBe('2025');
    expect(out.topModels).toHaveLength(1);
    expect(out.topModels[0].model).toBe('Tucson');
    expect(out.topModels[0].retailLatest).toBe(60_000);
  });
});

// ============================================================
// Phase 2E — 분기별 IR region 도매 (source='ir-quarterly')
// ============================================================

function quarterRegionRow(opts: {
  period: string;
  region: string;
  units: number;
  source?: HyundaiExportRegionRow['source'];
  periodType?: HyundaiExportRegionRow['period_type'];
}): HyundaiExportRegionRow {
  return {
    period_type: opts.periodType ?? 'quarter',
    year_period: opts.period,
    source: opts.source ?? 'ir-quarterly',
    region_name: opts.region,
    sales_units: opts.units,
  };
}

describe('aggregateHyundaiQuarterlyRegions', () => {
  it('ir-quarterly + period_type=quarter만 필터, 천대 환산, 분기 오름차순', () => {
    const rows: HyundaiExportRegionRow[] = [
      // 다른 source/period_type은 제외돼야 함
      quarterRegionRow({
        period: '2025',
        region: '미국',
        units: 1_000_000,
        source: 'ir-summary',
        periodType: 'annual',
      }),
      quarterRegionRow({
        period: '2025-01',
        region: '미국',
        units: 50_000,
        source: 'export-by-region',
        periodType: 'month',
      }),
      // 실제 대상 (대 단위 저장 → 천대 표시)
      quarterRegionRow({ period: '2025-Q2', region: '미국', units: 250_000 }),
      quarterRegionRow({ period: '2025-Q2', region: '유럽', units: 150_000 }),
      quarterRegionRow({ period: '2025-Q1', region: '미국', units: 200_000 }),
      quarterRegionRow({ period: '2025-Q1', region: '유럽', units: 120_000 }),
    ];
    const out = aggregateHyundaiQuarterlyRegions(rows);
    expect(out).toHaveLength(2);
    expect(out[0].period).toBe('2025-Q1');
    expect(out[0].period_label).toBe('25Q1');
    expect(out[0].regions).toEqual({ 미국: 200, 유럽: 120 });
    expect(out[0].total).toBe(320);
    expect(out[1].period).toBe('2025-Q2');
    expect(out[1].regions).toEqual({ 미국: 250, 유럽: 150 });
    expect(out[1].total).toBe(400);
  });

  it('region 누락 분기는 키 자체 없음 (러시아 사례)', () => {
    const rows: HyundaiExportRegionRow[] = [
      // 2024-Q4: 러시아 있음
      quarterRegionRow({ period: '2024-Q4', region: '미국', units: 200_000 }),
      quarterRegionRow({ period: '2024-Q4', region: '러시아', units: 30_000 }),
      // 2025-Q1: 러시아 없음
      quarterRegionRow({ period: '2025-Q1', region: '미국', units: 220_000 }),
    ];
    const out = aggregateHyundaiQuarterlyRegions(rows);
    expect(out[0].regions['러시아']).toBe(30);
    expect(out[1].regions['러시아']).toBeUndefined();
  });

  it('데이터 없으면 빈 배열', () => {
    const out = aggregateHyundaiQuarterlyRegions([]);
    expect(out).toEqual([]);
  });
});
