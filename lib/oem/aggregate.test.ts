/**
 * OEM 사전 가공 4종 단위 테스트 — pure 함수, mocking 없음.
 *
 * fixture는 각 테스트 안에 inline (재사용 안 함). OEM 이름은 괄호·슬래시 없이
 * 단순하게 — shortenOemName이 identity가 되도록.
 */
import { describe, expect, it } from 'vitest';
import type {
  OemSalesGroupCountryMonth,
  OemSalesModelCountryMonth,
} from '@/lib/types';
import {
  aggregateCountryTop15,
  aggregateModelSeries,
  aggregateOemCountryMatrix,
  aggregateUsaOemSeries,
  HEATMAP_FORCED_COUNTRIES,
  YEAR_2025_END,
  YEAR_2025_START,
} from './aggregate';

/** GCM(GroupCountryMonth) row — 필요한 4개 필드만 (테이블의 다른 컬럼은 무시). */
function gcm(
  oem_group: string,
  country: string,
  year_month: number,
  sales: number
): OemSalesGroupCountryMonth {
  return { oem_group, country, year_month, sales } as OemSalesGroupCountryMonth;
}

function mcm(
  model: string,
  country: string,
  year_month: number,
  sales: number
): OemSalesModelCountryMonth {
  return { model, country, year_month, sales } as OemSalesModelCountryMonth;
}

describe('aggregateCountryTop15', () => {
  it('2025년 윈도우 밖 rows 무시', () => {
    const result = aggregateCountryTop15([
      gcm('Toyota Group', 'Japan', 202412, 100), // 2024 → 무시
      gcm('Toyota Group', 'Japan', 202501, 50),
      gcm('Toyota Group', 'Japan', YEAR_2025_END + 1, 999), // 2026 → 무시
    ]);
    expect(result).toEqual([{ name: 'Japan', sales: 50 }]);
  });

  it('country별 합계 + sales 내림차순 정렬', () => {
    const result = aggregateCountryTop15([
      gcm('A', 'USA', 202503, 100),
      gcm('A', 'USA', 202504, 200),
      gcm('B', 'Japan', 202505, 500),
      gcm('C', 'Korea', 202506, 50),
    ]);
    expect(result).toEqual([
      { name: 'Japan', sales: 500 },
      { name: 'USA', sales: 300 },
      { name: 'Korea', sales: 50 },
    ]);
  });

  it('TOP15 슬라이스 — 16개 country 입력 시 15개만', () => {
    const rows: OemSalesGroupCountryMonth[] = [];
    for (let i = 0; i < 16; i++) {
      rows.push(gcm('A', `C${i}`, YEAR_2025_START, 100 - i)); // C0=100, C1=99, ..., C15=85
    }
    const result = aggregateCountryTop15(rows);
    expect(result).toHaveLength(15);
    expect(result[0]).toEqual({ name: 'C0', sales: 100 });
    expect(result[14]).toEqual({ name: 'C14', sales: 86 });
  });

  it('빈 입력 → 빈 배열', () => {
    expect(aggregateCountryTop15([])).toEqual([]);
  });
});

describe('aggregateOemCountryMatrix', () => {
  it('TOP10 OEM × TOP10 Country 매트릭스 + Korea 강제 포함', () => {
    // 12 OEM × 11 country (TOP10 + Korea(작은 매출이지만 강제))
    const rows: OemSalesGroupCountryMonth[] = [];
    for (let oi = 0; oi < 12; oi++) {
      const oem = `OEM${String(oi).padStart(2, '0')}`;
      for (let ci = 0; ci < 11; ci++) {
        const country = ci === 10 ? 'Korea' : `C${ci}`;
        const sales = ci === 10 ? 1 : (12 - oi) * (11 - ci) * 100; // OEM00이 최대, C0이 최대
        rows.push(gcm(oem, country, YEAR_2025_START, sales));
      }
    }
    const { oems, countries, matrix } = aggregateOemCountryMatrix(rows);

    expect(oems).toHaveLength(10);
    expect(oems[0]).toBe('OEM00');
    expect(oems[9]).toBe('OEM09');
    // OEM10, OEM11 제외 확인
    expect(oems.includes('OEM10')).toBe(false);

    // Korea가 강제로 마지막에 포함됨 (TOP10 country 중 매출 작아 누락됐을 것)
    expect(countries).toContain('Korea');
    expect(countries[countries.length - 1]).toBe('Korea');

    // matrix는 oems.length × countries.length
    expect(matrix).toHaveLength(10);
    expect(matrix[0]).toHaveLength(countries.length);
  });

  it('Korea가 TOP10 안에 이미 있으면 중복 추가 안 함', () => {
    const rows: OemSalesGroupCountryMonth[] = [
      gcm('A', 'Korea', YEAR_2025_START, 9999),
      gcm('A', 'USA', YEAR_2025_START, 100),
    ];
    const { countries } = aggregateOemCountryMatrix(rows);
    expect(countries.filter((c) => c === 'Korea')).toHaveLength(1);
  });

  it('2025년 윈도우 밖 무시', () => {
    const rows: OemSalesGroupCountryMonth[] = [
      gcm('A', 'USA', 202412, 999),
      gcm('A', 'USA', 202501, 100),
    ];
    const { oems, matrix } = aggregateOemCountryMatrix(rows);
    expect(oems).toEqual(['A']);
    // 첫 셀(A,USA) = 100. 2024년 무시.
    expect(matrix[0][0]).toBe(100);
  });

  it('빈 입력 → 빈 결과', () => {
    const result = aggregateOemCountryMatrix([]);
    expect(result.oems).toEqual([]);
    // Korea 강제 포함은 oems 없으면 의미 없지만 countries에는 들어감
    expect(result.countries).toEqual([...HEATMAP_FORCED_COUNTRIES]);
    expect(result.matrix).toEqual([]);
  });
});

describe('aggregateModelSeries', () => {
  it('NA_MODEL_TARGETS의 5개 모두 결과에 포함 (데이터 없으면 빈 data)', () => {
    const result = aggregateModelSeries([]);
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.key)).toEqual([
      'grand_cherokee',
      'ram_truck',
      'pacifica',
      'rivian_r1',
      'atlas',
    ]);
    for (const r of result) expect(r.data).toEqual([]);
  });

  it('USA 외 country 무시', () => {
    const result = aggregateModelSeries([
      mcm('Ram P/U', 'Canada', 202501, 1000), // USA 아님 → 무시
      mcm('Ram P/U', 'USA', 202501, 500),
    ]);
    const ram = result.find((r) => r.key === 'ram_truck')!;
    expect(ram.data).toHaveLength(1);
    expect(ram.data[0].sales).toBe(500);
  });

  it('target에 없는 model 무시', () => {
    const result = aggregateModelSeries([
      mcm('Unknown Model', 'USA', 202501, 999),
      mcm('Ram P/U', 'USA', 202501, 100),
    ]);
    const ram = result.find((r) => r.key === 'ram_truck')!;
    expect(ram.data).toEqual([{ ym: 202501, ymLabel: '2025.01', sales: 100, yoy: null }]);
  });

  it('Rivian R1: R1T + R1S 합산', () => {
    const result = aggregateModelSeries([
      mcm('R1T', 'USA', 202501, 60),
      mcm('R1S', 'USA', 202501, 40),
    ]);
    const rivian = result.find((r) => r.key === 'rivian_r1')!;
    expect(rivian.data[0].sales).toBe(100);
  });

  it('YoY 계산 — 전년동월 sales ≥ MIN_YOY_PREV_SALES(10)일 때만', () => {
    const result = aggregateModelSeries([
      mcm('Ram P/U', 'USA', 202401, 100), // 전년동월
      mcm('Ram P/U', 'USA', 202501, 150), // 50% 상승
      mcm('Ram P/U', 'USA', 202402, 5), // 임계값 미만
      mcm('Ram P/U', 'USA', 202502, 50),
    ]);
    const ram = result.find((r) => r.key === 'ram_truck')!;
    const m202501 = ram.data.find((d) => d.ym === 202501)!;
    const m202502 = ram.data.find((d) => d.ym === 202502)!;
    expect(m202501.yoy).toBe(50);
    expect(m202502.yoy).toBe(null); // prev=5 < 10
    // 전년동월은 자체로는 yoy=null (그 앞 년도 데이터 없음)
    const m202401 = ram.data.find((d) => d.ym === 202401)!;
    expect(m202401.yoy).toBe(null);
  });

  it('ym 정렬 (오름차순)', () => {
    const result = aggregateModelSeries([
      mcm('Ram P/U', 'USA', 202503, 30),
      mcm('Ram P/U', 'USA', 202501, 10),
      mcm('Ram P/U', 'USA', 202502, 20),
    ]);
    const ram = result.find((r) => r.key === 'ram_truck')!;
    expect(ram.data.map((d) => d.ym)).toEqual([202501, 202502, 202503]);
  });
});

describe('aggregateUsaOemSeries', () => {
  it('USA 외 country 무시', () => {
    const { brands, data } = aggregateUsaOemSeries([
      gcm('Toyota Group', 'Japan', 202501, 9999),
      gcm('Toyota Group', 'USA', 202501, 100),
    ]);
    expect(brands).toEqual(['Toyota Group']);
    expect(data[0].usaTotal).toBe(100);
  });

  it('TOP10 brand 선정 — 전체 기간 USA 합계 기준', () => {
    const rows: OemSalesGroupCountryMonth[] = [];
    for (let oi = 0; oi < 12; oi++) {
      rows.push(gcm(`OEM${String(oi).padStart(2, '0')}`, 'USA', 202501, (12 - oi) * 100));
    }
    const { brands, data } = aggregateUsaOemSeries(rows);
    expect(brands).toHaveLength(10);
    expect(brands[0]).toBe('OEM00');
    expect(brands[9]).toBe('OEM09');
    // TOP10 외 OEM도 usaTotal에는 합산됨
    const total = (12 * 13 * 100) / 2; // 12+11+...+1 = 78 → 7800
    expect(data[0].usaTotal).toBe(total);
  });

  it('시간순 정렬 + 누락 brand는 0으로 채움', () => {
    const { data } = aggregateUsaOemSeries([
      gcm('A', 'USA', 202503, 30),
      gcm('A', 'USA', 202501, 10),
      gcm('B', 'USA', 202502, 20), // 'B'는 202502만 존재
    ]);
    expect(data.map((d) => d.ym)).toEqual([202501, 202502, 202503]);
    // brand B는 202501·202503에서 0으로 채워야
    expect(data[0]['B']).toBe(0);
    expect(data[2]['B']).toBe(0);
    expect(data[1]['B']).toBe(20);
  });

  it('ymLabel 포함', () => {
    const { data } = aggregateUsaOemSeries([gcm('A', 'USA', 202501, 100)]);
    expect(data[0].ymLabel).toBe('2025.01');
  });

  it('빈 입력', () => {
    const result = aggregateUsaOemSeries([]);
    expect(result.brands).toEqual([]);
    expect(result.data).toEqual([]);
  });
});
