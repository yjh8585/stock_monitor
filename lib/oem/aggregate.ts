/**
 * OEM 페이지 사전 가공 — pure 함수만.
 *
 * 모든 함수는 입력(raw rows) → 출력(가공 객체), 사이드 이펙트 없음.
 * `lib/oem/source.ts`의 'use cache' 안에서 호출되며, 117K+ 행을 작은 props로 줄여
 * 클라이언트에 전달한다.
 *
 * 테스트는 `aggregate.test.ts` 참고 (vitest, mocking 없음).
 */
import { ymLabel as ymLabelFn, shortenOemName } from '@/components/oem/helpers';
import type { UsaOemTimeSeriesData } from '@/components/oem/UsaOemTrendChart';
import type {
  ModelMonthlySeries,
  OemSalesGroupCountryMonth,
  OemSalesModelCountryMonth,
} from '@/lib/types';

export const COUNTRY_TOP_N = 15;
export const HEATMAP_TOP_N = 10;
export const YEAR_2025_START = 202501;
export const YEAR_2025_END = 202512;
/** 매트릭스 강제 포함 국가 (TOP10 누락 시에도 컬럼 표시) */
export const HEATMAP_FORCED_COUNTRIES = ['Korea'];

/** 북미 핵심 차종 fetch + 시리즈 가공 시 공통 사용. */
export const NA_COUNTRY = 'USA';
/** pre-production 소량(1~2대) 기간이 YoY 기준월이 되면 수천% 이상치 → 최소 임계값 적용 */
export const MIN_YOY_PREV_SALES = 10;

/** 콤보 차트 한 개(모델 그룹) 정의. models는 합산 대상 원본 모델명들. */
export interface ModelTarget {
  key: string;
  label: string;
  oemGroup: string;
  models: string[];
}

export const NA_MODEL_TARGETS: ModelTarget[] = [
  {
    key: 'grand_cherokee',
    label: 'Grand Cherokee',
    oemGroup: 'Stellantis',
    models: ['Grand Cherokee (Jeep (2009-))'],
  },
  {
    key: 'ram_truck',
    label: 'Ram Truck',
    oemGroup: 'Stellantis',
    models: ['Ram P/U'],
  },
  {
    key: 'pacifica',
    label: 'Pacifica',
    oemGroup: 'Stellantis',
    models: ['Pacifica (Chrysler (2009-))'],
  },
  {
    key: 'rivian_r1',
    label: 'Rivian R1 (T+S)',
    oemGroup: 'Small and Medium OEM',
    models: ['R1T', 'R1S'],
  },
  {
    key: 'atlas',
    label: 'VW Atlas',
    oemGroup: 'VW Group',
    models: ['VW Atlas'],
  },
];

/**
 * 기타 핵심 차종 — 전 국가(글로벌) 합산 대상.
 * 아반떼/엘란트라는 DB에 중국 전용 변형이 별도 모델명으로 존재해 '중국 외'/'중국' 2개로 분리한다.
 */
export const OTHER_MODEL_TARGETS: ModelTarget[] = [
  {
    key: 'porsche_911',
    label: 'Porsche 911',
    oemGroup: 'VW Group (Porsche)',
    models: ['Porsche 911'],
  },
  {
    key: 'seltos',
    label: 'Seltos (셀토스)',
    oemGroup: 'Hyundai Kia',
    models: ['SELTOS'],
  },
  {
    key: 'avante_ex_china',
    label: 'Avante/Elantra (중국 외)',
    oemGroup: 'Hyundai Kia',
    models: ['Avante (Elantra)', 'Avante'],
  },
  {
    key: 'avante_china',
    label: 'Avante/Elantra (중국)',
    oemGroup: 'Hyundai Kia',
    models: ['Elantra/Yuedong/Langdong/Elantra 2016', 'Elantra Yuedong'],
  },
  {
    key: 'niro',
    label: 'Niro (니로)',
    oemGroup: 'Hyundai Kia',
    models: ['NIRO'],
  },
];

/** 2025년 Country별 합계 TOP15. */
export function aggregateCountryTop15(
  rows: OemSalesGroupCountryMonth[]
): { name: string; sales: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.year_month < YEAR_2025_START || r.year_month > YEAR_2025_END) continue;
    m.set(r.country, (m.get(r.country) ?? 0) + r.sales);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, COUNTRY_TOP_N)
    .map(([name, sales]) => ({ name, sales }));
}

/** TOP10 OEM × TOP10 Country 매트릭스 (2025) + Korea 강제 포함. */
export function aggregateOemCountryMatrix(rows: OemSalesGroupCountryMonth[]): {
  oems: string[];
  countries: string[];
  matrix: number[][];
} {
  const oemTotal = new Map<string, number>();
  const countryTotal = new Map<string, number>();
  for (const r of rows) {
    if (r.year_month < YEAR_2025_START || r.year_month > YEAR_2025_END) continue;
    oemTotal.set(r.oem_group, (oemTotal.get(r.oem_group) ?? 0) + r.sales);
    countryTotal.set(r.country, (countryTotal.get(r.country) ?? 0) + r.sales);
  }
  const oems = [...oemTotal.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, HEATMAP_TOP_N)
    .map(([n]) => n);
  const countriesTop = [...countryTotal.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, HEATMAP_TOP_N)
    .map(([n]) => n);
  // 강제 포함 국가 머지 (중복 제거, 데이터 미존재 시에도 빈 컬럼)
  const countries = Array.from(new Set([...countriesTop, ...HEATMAP_FORCED_COUNTRIES]));
  const oemSet = new Set(oems);
  const countrySet = new Set(countries);
  const cell = new Map<string, number>();
  for (const r of rows) {
    if (r.year_month < YEAR_2025_START || r.year_month > YEAR_2025_END) continue;
    if (!oemSet.has(r.oem_group) || !countrySet.has(r.country)) continue;
    const k = `${r.oem_group}|${r.country}`;
    cell.set(k, (cell.get(k) ?? 0) + r.sales);
  }
  const matrix = oems.map((oem) => countries.map((c) => cell.get(`${oem}|${c}`) ?? 0));
  return { oems, countries, matrix };
}

/**
 * 모델 그룹별 월별 시리즈 + YoY 가공 (공통 빌더).
 *
 * `countryFilter`가 주어지면 해당 국가만, `null`이면 전 국가 합산.
 * 빈 월은 0으로 채우고, 전년동월(prevYm = ym - 100) 매출이 임계값 이상일 때만 YoY 계산.
 */
function buildModelSeries(
  rows: OemSalesModelCountryMonth[],
  targets: ModelTarget[],
  countryFilter: string | null
): ModelMonthlySeries[] {
  const result: ModelMonthlySeries[] = [];
  for (const target of targets) {
    const modelSet = new Set(target.models);
    const ymMap = new Map<number, number>();
    for (const r of rows) {
      if (countryFilter !== null && r.country !== countryFilter) continue;
      if (!modelSet.has(r.model)) continue;
      ymMap.set(r.year_month, (ymMap.get(r.year_month) ?? 0) + r.sales);
    }
    const sorted = [...ymMap.keys()].sort((a, b) => a - b);
    if (sorted.length === 0) {
      result.push({ key: target.key, label: target.label, oemGroup: target.oemGroup, data: [] });
      continue;
    }
    const data = sorted.map((ym) => {
      const sales = ymMap.get(ym) ?? 0;
      const prevYm = ym - 100;
      const prevSales = ymMap.get(prevYm);
      const yoy =
        prevSales != null && prevSales >= MIN_YOY_PREV_SALES
          ? ((sales - prevSales) / prevSales) * 100
          : null;
      return { ym, ymLabel: ymLabelFn(ym), sales, yoy };
    });
    result.push({ key: target.key, label: target.label, oemGroup: target.oemGroup, data });
  }
  return result;
}

/** 북미 핵심 차종 5종 — USA 시장만 합산. */
export function aggregateModelSeries(rows: OemSalesModelCountryMonth[]): ModelMonthlySeries[] {
  return buildModelSeries(rows, NA_MODEL_TARGETS, NA_COUNTRY);
}

/** 기타 핵심 차종 5종 — 전 국가(글로벌) 합산. */
export function aggregateOtherModelSeries(rows: OemSalesModelCountryMonth[]): ModelMonthlySeries[] {
  return buildModelSeries(rows, OTHER_MODEL_TARGETS, null);
}

/**
 * 미국 시장 TOP10 OEM 월별 시계열 — 전체 기간 USA 합계 기준 TOP10 선정.
 *
 * 누락 brand는 0으로 채워 차트가 흔들리지 않게 한다.
 */
export function aggregateUsaOemSeries(rows: OemSalesGroupCountryMonth[]): UsaOemTimeSeriesData {
  const usaRows = rows.filter((r) => r.country === 'USA');

  const totalByBrand = new Map<string, number>();
  for (const r of usaRows)
    totalByBrand.set(r.oem_group, (totalByBrand.get(r.oem_group) ?? 0) + r.sales);
  const top10Full = [...totalByBrand.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([g]) => g);
  const top10Set = new Set(top10Full);
  const labelMap = new Map(top10Full.map((g) => [g, shortenOemName(g)]));
  const brands = top10Full.map((g) => labelMap.get(g)!);

  const byYm = new Map<number, Record<string, number | string>>();
  for (const r of usaRows) {
    if (!byYm.has(r.year_month))
      byYm.set(r.year_month, {
        ym: r.year_month,
        ymLabel: ymLabelFn(r.year_month),
        usaTotal: 0,
      });
    const row = byYm.get(r.year_month)!;
    (row as Record<string, number>).usaTotal += r.sales;
    if (!top10Set.has(r.oem_group)) continue;
    const lbl = labelMap.get(r.oem_group)!;
    row[lbl] = ((row[lbl] as number) ?? 0) + r.sales;
  }

  const data = [...byYm.values()].sort((a, b) => (a.ym as number) - (b.ym as number));
  for (const row of data) {
    for (const b of brands) if (row[b] == null) row[b] = 0;
  }
  return { brands, data };
}
