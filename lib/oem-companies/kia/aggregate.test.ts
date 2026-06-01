/**
 * 기아 aggregate.ts 단위 테스트 — pure 함수.
 * 현대차 패턴 + Kia 특이사항(Aggregate 모델 제외, CKD region 포함) 검증.
 */
import { describe, expect, it } from 'vitest';
import type {
  CompanySaleRowWithPt,
  KiaExportRegionRow,
  KiaSaleRow,
  VehiclePowertrainMapRow,
} from '@/lib/types';
import {
  aggregateAnnualSeries,
  aggregateKiaExportRegions,
  aggregateKiaExportTypeMix,
  aggregateKiaFactoryMix,
  aggregateKiaFactoryMixAnnual,
  aggregateKpi,
  aggregateMonthlySeries,
  aggregatePtMix,
  aggregateTopModels,
  attachPowertrains,
  kiaTopPrevYearLabel,
  listEvModels,
  normalizeKiaVehicleType,
  partialYearNote,
} from './aggregate';

function row(opts: {
  period?: string;
  region?: string;
  factory?: string;
  model: string;
  type?: string;
  pt?: KiaSaleRow['powertrain'];
  units: number;
}): KiaSaleRow {
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
    company_slug: 'kia',
    vehicle_model: model,
    powertrain: pt,
    valid_from: '2021-01-01',
    valid_to: null,
    source_note: null,
  };
}

function withPt(rows: KiaSaleRow[]): (CompanySaleRowWithPt & { factory: string })[] {
  return rows.map((r) => ({ ...r, resolved_powertrain: r.powertrain }));
}

function exportRow(opts: {
  period?: string;
  region: string;
  type: string;
  units: number;
  source?: KiaExportRegionRow['source'];
  periodType?: KiaExportRegionRow['period_type'];
}): KiaExportRegionRow {
  return {
    period_type: opts.periodType ?? 'month',
    year_period: opts.period ?? '2025-01',
    source: opts.source ?? 'export-by-region',
    region_name: opts.region,
    vehicle_type: opts.type,
    sales_units: opts.units,
  };
}

describe('normalizeKiaVehicleType', () => {
  it('연도별 표기 차이 흡수 (KD/CKD(Inc/excl) → CKD_ex, Special VAR → SV)', () => {
    expect(normalizeKiaVehicleType('Passenger Car')).toBe('PC');
    expect(normalizeKiaVehicleType('Recreational Vehicle')).toBe('RV');
    expect(normalizeKiaVehicleType('Commercial Vehicle')).toBe('CV');
    expect(normalizeKiaVehicleType('Special Vehicle')).toBe('SV');
    expect(normalizeKiaVehicleType('KD')).toBe('CKD_ex');
    expect(normalizeKiaVehicleType('CKD(Inc, Special Vehicle)')).toBe('CKD_ex');
    expect(normalizeKiaVehicleType('CKD(excl, Special Vehicle)')).toBe('CKD_ex');
    expect(normalizeKiaVehicleType('CKD(Special Vehicle)')).toBe('CKD_sp');
  });
});

describe('aggregateKpi — isCountable (해외 공장 + 한국 내수/수출/CKD)', () => {
  it('CKD region(Aggregate row)도 회사 전체 합계에 포함', () => {
    const rows = withPt([
      row({ period: '2025-01', region: '내수', model: 'Sportage', units: 1000 }),
      row({ period: '2025-01', region: '수출', model: 'Sportage', units: 500 }),
      row({ period: '2025-01', region: 'CKD', model: 'Aggregate', units: 200 }),
      row({ period: '2025-01', factory: 'U.S. Plant', region: '', model: 'Sportage', units: 800 }),
    ]);
    const ms = aggregateMonthlySeries(rows);
    expect(ms[0].sales).toBe(1000 + 500 + 200 + 800);
  });

  it('latestPeriod=2025-12 → 2025 실적 + 2026 YTD(대기)', () => {
    const rows: KiaSaleRow[] = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        rows.push(
          row({
            period: `${y}-${String(m).padStart(2, '0')}`,
            region: '내수',
            model: 'A',
            units: 100,
          })
        );
      }
    }
    const out = aggregateKpi(withPt(rows));
    expect(out.latestYearLabel).toBe('2025년 실적');
    expect(out.latestYearSales).toBe(1200);
    expect(out.ytdLabel).toBe('2026 YTD (대기)');
  });
});

describe('aggregateAnnualSeries', () => {
  it('연 단위 합산 (한국+해외 공장+CKD 모두 포함)', () => {
    const rows = withPt([
      row({ period: '2024-01', region: '내수', model: 'A', units: 100 }),
      row({ period: '2024-06', region: '수출', model: 'A', units: 200 }),
      row({ period: '2024-06', region: 'CKD', model: 'Aggregate', units: 50 }),
      row({ period: '2025-03', region: '내수', model: 'A', units: 400 }),
      row({ period: '2025-03', factory: 'India Plant', region: '', model: 'A', units: 1000 }),
    ]);
    const out = aggregateAnnualSeries(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ period: '2024', sales: 350 });
    expect(out[1]).toMatchObject({ period: '2025', sales: 1400 });
  });
});

describe('aggregateTopModels — Aggregate 모델 제외', () => {
  it('CKD section 합계 Aggregate row는 TOP에서 제외', () => {
    const rows: KiaSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const p = `2025-${String(m).padStart(2, '0')}`;
      rows.push(row({ period: p, region: '내수', model: 'Sportage', units: 1000 }));
      rows.push(row({ period: p, region: 'CKD', model: 'Aggregate', units: 9999 }));
    }
    const out = aggregateTopModels(withPt(rows), 5, 'all');
    const models = out.rows.map((r) => r.model);
    expect(models).not.toContain('Aggregate');
    expect(models).toContain('Sportage');
  });

  it('domestic 필터 = 한국 공장 출하만 (해외 공장 제외, 내수+수출+CKD 합산)', () => {
    const rows: KiaSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      const p = `2025-${String(m).padStart(2, '0')}`;
      rows.push(row({ period: p, region: '내수', model: 'A', units: 100 }));
      rows.push(row({ period: p, region: '수출', model: 'A', units: 200 }));
      // 해외 공장 — domestic 모드에선 제외
      rows.push(row({ period: p, factory: 'India Plant', region: '', model: 'A', units: 999 }));
    }
    const all = aggregateTopModels(withPt(rows), 5, 'all');
    const domestic = aggregateTopModels(withPt(rows), 5, 'domestic');
    expect(all.rows[0].salesLatestPeriod).toBe(12 * (100 + 200 + 999));
    expect(domestic.rows[0].salesLatestPeriod).toBe(12 * (100 + 200));
  });
});

describe('aggregateKiaFactoryMix', () => {
  it("월별 공장별 합산 — 한국 출하(factory='')는 'Korea Plants'로 포함", () => {
    const rows = withPt([
      row({ period: '2025-01', factory: 'U.S. Plant', region: '', model: 'A', units: 1000 }),
      row({ period: '2025-01', factory: 'China Plants', region: '', model: 'A', units: 500 }),
      row({ period: '2025-01', region: '내수', model: 'A', units: 100 }), // Korea Plants로 포함
    ]);
    const out = aggregateKiaFactoryMix(rows);
    expect(out).toHaveLength(1);
    expect(out[0].factories).toEqual({
      'U.S. Plant': 1000,
      'China Plants': 500,
      'Korea Plants': 100,
    });
    expect(out[0].total).toBe(1600);
  });

  it('연간 공장별 합산', () => {
    const rows = withPt([
      row({ period: '2024-01', factory: 'U.S. Plant', region: '', model: 'A', units: 100 }),
      row({ period: '2024-06', factory: 'U.S. Plant', region: '', model: 'A', units: 200 }),
      row({ period: '2025-03', factory: 'India Plant', region: '', model: 'A', units: 500 }),
    ]);
    const out = aggregateKiaFactoryMixAnnual(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      period: '2024',
      factories: { 'U.S. Plant': 300 },
      total: 300,
    });
    expect(out[1]).toMatchObject({
      period: '2025',
      factories: { 'India Plant': 500 },
      total: 500,
    });
  });

  it('PR 보완분(Overseas (PR) factory + Aggregate (PR) model) 제외 → 2024는 1~10월(2024.10)', () => {
    const rows: KiaSaleRow[] = [];
    for (let m = 1; m <= 10; m++) {
      const p = `2024-${String(m).padStart(2, '0')}`;
      rows.push(row({ period: p, region: '내수', model: 'A', units: 100 }));
      rows.push(row({ period: p, factory: 'U.S. Plant', region: '', model: 'A', units: 200 }));
    }
    // 11~12월 PR 보완분 — 공장 분해 불가, 제외 대상
    rows.push(row({ period: '2024-11', region: '내수', model: 'Aggregate (PR)', units: 48000 }));
    rows.push(
      row({
        period: '2024-11',
        factory: 'Overseas (PR)',
        region: '',
        model: 'Aggregate (PR)',
        units: 200000,
      })
    );
    rows.push(row({ period: '2024-12', region: '내수', model: 'Aggregate (PR)', units: 44000 }));
    rows.push(
      row({
        period: '2024-12',
        factory: 'Overseas (PR)',
        region: '',
        model: 'Aggregate (PR)',
        units: 200000,
      })
    );
    const out = aggregateKiaFactoryMixAnnual(withPt(rows));
    expect(out).toHaveLength(1);
    expect(out[0].period_label).toBe('2024.10');
    expect(out[0].factories['Overseas (PR)']).toBeUndefined();
    expect(out[0].factories['Korea Plants']).toBe(1000); // 10개월 × 100
    expect(out[0].factories['U.S. Plant']).toBe(2000); // 10개월 × 200
  });
});

describe('aggregatePtMix', () => {
  it('powertrain 매핑된 EV 차종은 EV로 카운트', () => {
    const rows = withPt([
      row({ period: '2025-01', region: '내수', model: 'EV6', pt: 'EV', units: 100 }),
      row({ period: '2025-01', region: '수출', model: 'EV6', pt: 'EV', units: 200 }),
      row({ period: '2025-01', region: '내수', model: 'Sportage', units: 1000 }), // PT null → Unknown
    ]);
    const out = aggregatePtMix(rows);
    expect(out[0].EV).toBe(300);
    expect(out[0].Unknown).toBe(1000);
    expect(out[0].total).toBe(1300);
  });
});

describe('attachPowertrains', () => {
  it('kia 매핑 → resolved_powertrain', () => {
    const rows = [row({ region: '내수', model: 'EV6', units: 100 })];
    const map = [ptRow('EV6', 'EV')];
    const out = attachPowertrains(rows, map);
    expect(out[0].resolved_powertrain).toBe('EV');
    expect(out[0].factory).toBe('');
  });
});

describe('aggregateKiaExportRegions', () => {
  it('export-by-region 월 → region별 합산, source 필터링', () => {
    const rows: KiaExportRegionRow[] = [
      exportRow({ period: '2025-01', region: 'U.S.', type: 'Passenger Car', units: 100 }),
      exportRow({ period: '2025-01', region: 'U.S.', type: 'Recreational Vehicle', units: 200 }),
      exportRow({ period: '2025-01', region: 'Canada', type: 'Passenger Car', units: 50 }),
      // 다른 source는 제외
      exportRow({
        period: '2025-Q1',
        region: 'U.S.',
        type: '',
        units: 9999,
        source: 'ir-quarterly',
        periodType: 'quarter',
      }),
    ];
    const out = aggregateKiaExportRegions(rows, 'month');
    expect(out).toHaveLength(1);
    expect(out[0].regions).toEqual({ 'U.S.': 300, Canada: 50 });
    expect(out[0].total).toBe(350);
  });

  it('진행 중 연도(12월 미만) → YYYY YTD 라벨 + is_ytd=true', () => {
    const rows: KiaExportRegionRow[] = [];
    for (let m = 1; m <= 12; m++) {
      rows.push(
        exportRow({
          period: `2025-${String(m).padStart(2, '0')}`,
          region: 'U.S.',
          type: 'Passenger Car',
          units: 100,
        })
      );
    }
    for (let m = 1; m <= 4; m++) {
      rows.push(
        exportRow({
          period: `2026-${String(m).padStart(2, '0')}`,
          region: 'U.S.',
          type: 'Passenger Car',
          units: 100,
        })
      );
    }
    const out = aggregateKiaExportRegions(rows, 'annual');
    expect(out).toHaveLength(2);
    expect(out[0].period).toBe('2025');
    expect(out[0].is_ytd).toBe(false);
    expect(out[1].period).toBe('2026 YTD');
    expect(out[1].is_ytd).toBe(true);
  });
});

describe('aggregateKiaExportTypeMix', () => {
  it('연도별 vehicle_type 차이 흡수 (KD/CKD 명칭 다양) → 6 카테고리 합산', () => {
    const rows: KiaExportRegionRow[] = [
      exportRow({ period: '2025-01', region: 'U.S.', type: 'Passenger Car', units: 100 }),
      exportRow({ period: '2025-01', region: 'U.S.', type: 'Recreational Vehicle', units: 200 }),
      exportRow({ period: '2025-01', region: 'U.S.', type: 'Commercial Vehicle', units: 50 }),
      exportRow({ period: '2025-01', region: 'U.S.', type: 'Special Vehicle', units: 30 }),
      exportRow({
        period: '2025-01',
        region: 'U.S.',
        type: 'CKD(excl, Special Vehicle)',
        units: 20,
      }),
      exportRow({ period: '2025-01', region: 'U.S.', type: 'CKD(Special Vehicle)', units: 10 }),
      // 옛 표기
      exportRow({ period: '2025-01', region: 'Canada', type: 'KD', units: 5 }),
    ];
    const out = aggregateKiaExportTypeMix(rows, 'month');
    expect(out).toHaveLength(1);
    expect(out[0].PC).toBe(100);
    expect(out[0].RV).toBe(200);
    expect(out[0].CV).toBe(50);
    expect(out[0].SV).toBe(30);
    expect(out[0].CKD_ex).toBe(25); // 20 + 5(KD)
    expect(out[0].CKD_sp).toBe(10);
    expect(out[0].total).toBe(415);
  });
});

describe('partialYearNote', () => {
  it('과거 미완 연도(YYYY.NN)만 누계 안내 문구 생성', () => {
    const note = partialYearNote([
      { period_label: '2021', total: 100 },
      { period_label: '2024.10', total: 1234567 },
      { period_label: '2026 YTD', total: 50 },
    ]);
    expect(note).toBe('⚠ 2024년은 11~12월 미게재로 1~10월까지만 집계 (누계 1,234,567대)');
  });

  it('완비 연도/진행 연도(YTD)만 있으면 null', () => {
    expect(partialYearNote([{ period_label: '2023', total: 10 }])).toBeNull();
    expect(partialYearNote([{ period_label: '2026 YTD', total: 10 }])).toBeNull();
  });

  it('미완 연도 복수 → · 로 연결', () => {
    const note = partialYearNote([
      { period_label: '2023.06', total: 500 },
      { period_label: '2024.10', total: 1000 },
    ]);
    expect(note).toBe(
      '⚠ 2023년은 7~12월 미게재로 1~6월까지만 집계 (누계 500대) · 2024년은 11~12월 미게재로 1~10월까지만 집계 (누계 1,000대)'
    );
  });
});

describe('kiaTopPrevYearLabel', () => {
  it('직전 완료연도가 모델 분해 10월까지(11~12월 Aggregate) → 2024.10', () => {
    const rows: KiaSaleRow[] = [];
    for (let m = 1; m <= 10; m++) {
      rows.push(
        row({ period: `2024-${String(m).padStart(2, '0')}`, model: 'Sportage', units: 100 })
      );
    }
    // 2024 11~12월은 Aggregate 합계 보완(차종 분해 없음) → 제외돼야
    rows.push(row({ period: '2024-11', region: 'CKD', model: 'Aggregate', units: 5000 }));
    rows.push(row({ period: '2024-12', region: 'CKD', model: 'Aggregate', units: 5000 }));
    for (let m = 1; m <= 12; m++) {
      rows.push(
        row({ period: `2025-${String(m).padStart(2, '0')}`, model: 'Sportage', units: 100 })
      );
    }
    for (let m = 1; m <= 4; m++) {
      rows.push(
        row({ period: `2026-${String(m).padStart(2, '0')}`, model: 'Sportage', units: 100 })
      );
    }
    const out = kiaTopPrevYearLabel(attachPowertrains(rows, []));
    expect(out).toEqual({ label: '2024.10', lastMonth: 10, partial: true });
  });

  it('직전 완료연도가 12개월 완비 → YYYY년', () => {
    const rows: KiaSaleRow[] = [];
    for (let m = 1; m <= 12; m++) {
      rows.push(
        row({ period: `2024-${String(m).padStart(2, '0')}`, model: 'Sportage', units: 100 })
      );
    }
    for (let m = 1; m <= 12; m++) {
      rows.push(
        row({ period: `2025-${String(m).padStart(2, '0')}`, model: 'Sportage', units: 100 })
      );
    }
    for (let m = 1; m <= 4; m++) {
      rows.push(
        row({ period: `2026-${String(m).padStart(2, '0')}`, model: 'Sportage', units: 100 })
      );
    }
    const out = kiaTopPrevYearLabel(attachPowertrains(rows, []));
    expect(out.label).toBe('2024년');
    expect(out.partial).toBe(false);
  });
});

describe('listEvModels', () => {
  it('resolved EV & 판매>0 차종만 (Niro 포함), 정렬', () => {
    const map = [ptRow('EV6', 'EV'), ptRow('Niro', 'EV'), ptRow('Sportage', 'ICE')];
    const rows = attachPowertrains(
      [
        row({ model: 'EV6', units: 100 }),
        row({ model: 'Niro', units: 50 }),
        row({ model: 'Sportage', units: 1000 }),
        row({ model: 'EV9', units: 0 }), // 판매 0 → 제외
      ],
      map
    );
    expect(listEvModels(rows)).toEqual(['EV6', 'Niro']);
  });
});
