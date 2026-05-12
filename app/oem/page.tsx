import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import OemDashboard from '@/components/oem/OemDashboard';
import { ymLabel as ymLabelFn } from '@/components/oem/helpers';
import type { Database, TableRow } from '@/lib/database.types';
import type {
  ModelMonthlySeries,
  OemModelOutlook,
  OemSalesGroupCountryMonth,
  OemSalesGroupMonth,
  OemSalesGroupPtMonth,
  OemSalesModelCountryMonth,
  OemSalesTypeSegMonth,
} from '@/lib/types';

// PostgREST 기본 max-rows=1000. 페이지네이션으로 전체 fetch.
const SUPABASE_PAGE_SIZE = 1000;

const COUNTRY_TOP_N = 15;
const HEATMAP_TOP_N = 10;
const YEAR_2025_START = 202501;
const YEAR_2025_END = 202512;
// 사용자 요구로 매트릭스에 강제 포함할 국가 (TOP10 누락 시에도 컬럼 표시)
const HEATMAP_FORCED_COUNTRIES = ['Korea'];

// 북미(USA) 핵심 차종 5종 — 사용자 지정
const NA_COUNTRY = 'USA';
const NA_MODEL_TARGETS: { key: string; label: string; oemGroup: string; models: string[] }[] = [
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

type AnonClient = ReturnType<typeof createSupabaseAnonClient>;

/** Supabase 한 번 select에 max 1000행 → range 페이지네이션 + 실패 시 throw */
async function fetchAll<TName extends keyof Database['public']['Tables']>(
  supabase: AnonClient,
  table: TName
): Promise<TableRow<TName>[]> {
  const all: TableRow<TName>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error, table }, `${table} 조회 실패`);
      throw new Error(`Supabase ${table} 조회 실패: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as TableRow<TName>[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

/** model_country_month 중 USA + 대상 모델만 fetch (전체 적재량 크면 필터 조건으로 가벼움) */
async function fetchNaModelRows(supabase: AnonClient): Promise<OemSalesModelCountryMonth[]> {
  const allTargetModels = NA_MODEL_TARGETS.flatMap((t) => t.models);
  const out: OemSalesModelCountryMonth[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('oem_sales_model_country_month')
      .select('*')
      .eq('country', NA_COUNTRY)
      .in('model', allTargetModels)
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'oem_sales_model_country_month 조회 실패');
      // 테이블 미적재 단계 가능 — 빈 배열로 graceful fallback
      return [];
    }
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as OemSalesModelCountryMonth[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return out;
}

/** 2025년 Country별 합계 TOP15 */
function aggregateCountryTop15(rows: OemSalesGroupCountryMonth[]) {
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

/** TOP10 OEM × TOP10 Country 매트릭스 (2025) */
function aggregateOemCountryMatrix(rows: OemSalesGroupCountryMonth[]) {
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
  // 강제 포함 국가 머지 (중복 제거, 데이터 미존재 시에도 빈 컬럼으로 노출)
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

/** 5개 모델 그룹별 월별 시리즈 + YoY 가공 */
function aggregateModelSeries(rows: OemSalesModelCountryMonth[]): ModelMonthlySeries[] {
  const result: ModelMonthlySeries[] = [];
  for (const target of NA_MODEL_TARGETS) {
    const modelSet = new Set(target.models);
    // (ym) → sales 합산
    const ymMap = new Map<number, number>();
    for (const r of rows) {
      if (r.country !== NA_COUNTRY) continue;
      if (!modelSet.has(r.model)) continue;
      ymMap.set(r.year_month, (ymMap.get(r.year_month) ?? 0) + r.sales);
    }
    // 시작월~최신월까지 모두 채우기 (빈 월은 0)
    const sorted = [...ymMap.keys()].sort((a, b) => a - b);
    if (sorted.length === 0) {
      result.push({ key: target.key, label: target.label, oemGroup: target.oemGroup, data: [] });
      continue;
    }
    const data = sorted.map((ym) => {
      const sales = ymMap.get(ym) ?? 0;
      const prevYm = ym - 100;
      const prevSales = ymMap.get(prevYm);
      const yoy = prevSales && prevSales > 0 ? ((sales - prevSales) / prevSales) * 100 : null;
      return { ym, ymLabel: ymLabelFn(ym), sales, yoy };
    });
    result.push({ key: target.key, label: target.label, oemGroup: target.oemGroup, data });
  }
  return result;
}

/** AI 평가 카드 최신본 — 모델별 최근 1건씩 fetch */
async function fetchLatestOutlooks(supabase: AnonClient): Promise<OemModelOutlook[]> {
  const { data, error } = await supabase
    .from('oem_model_outlook')
    .select('*')
    .order('note_date', { ascending: false })
    .limit(200);
  if (error) {
    logger.error({ err: error }, 'oem_model_outlook 조회 실패 — 빈 배열 반환');
    return [];
  }
  if (!data) return [];
  // model_key별 최신 1건만
  const seen = new Set<string>();
  const out: OemModelOutlook[] = [];
  for (const row of data as unknown as OemModelOutlook[]) {
    if (seen.has(row.model_key)) continue;
    seen.add(row.model_key);
    out.push(row);
  }
  return out;
}

/** OEM 데이터 fetch + 사전 가공 — Cache Components 적용. cacheLife='hours'. */
async function getOemData() {
  'use cache';
  cacheLife('hours');
  cacheTag('oem_sales_group_month');
  cacheTag('oem_sales_group_pt_month');
  cacheTag('oem_sales_group_country_month');
  cacheTag('oem_sales_type_seg_month');
  cacheTag('oem_sales_model_country_month');
  cacheTag('oem_model_outlook');

  const supabase = createSupabaseAnonClient();
  const [
    groupMonthRaw,
    groupPtMonthRaw,
    groupCountryMonthRaw,
    typeSegMonthRaw,
    modelRows,
    outlooks,
  ] = await Promise.all([
    fetchAll(supabase, 'oem_sales_group_month'),
    fetchAll(supabase, 'oem_sales_group_pt_month'),
    fetchAll(supabase, 'oem_sales_group_country_month'),
    fetchAll(supabase, 'oem_sales_type_seg_month'),
    fetchNaModelRows(supabase),
    fetchLatestOutlooks(supabase),
  ]);

  const groupMonth: OemSalesGroupMonth[] = groupMonthRaw;
  const groupPtMonth: OemSalesGroupPtMonth[] = groupPtMonthRaw;
  const groupCountryMonth: OemSalesGroupCountryMonth[] = groupCountryMonthRaw;
  const typeSegMonth: OemSalesTypeSegMonth[] = typeSegMonthRaw;

  // 117K 행 groupCountryMonth → 서버에서 작은 props 사전 가공 후 client 전달
  const countryTop15 = aggregateCountryTop15(groupCountryMonth);
  const oemCountryMatrix = aggregateOemCountryMatrix(groupCountryMonth);
  const naModelSeries = aggregateModelSeries(modelRows);
  const oemGroupCount = new Set(groupMonth.map((r) => r.oem_group)).size;

  return {
    groupMonth,
    groupPtMonth,
    typeSegMonth,
    countryTop15,
    oemCountryMatrix,
    naModelSeries,
    outlooks,
    oemGroupCount,
  };
}

export default async function OemPage() {
  const data = await getOemData();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">글로벌 OEM 판매량 대시보드</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          MarkLines 글로벌 자동차 판매 데이터 · 2020.01~ · {data.oemGroupCount}개 OEM 그룹
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <OemDashboard
          groupMonth={data.groupMonth}
          groupPtMonth={data.groupPtMonth}
          typeSegMonth={data.typeSegMonth}
          countryTop15={data.countryTop15}
          oemCountryMatrix={data.oemCountryMatrix}
          naModelSeries={data.naModelSeries}
          outlooks={data.outlooks}
        />
      </div>
    </div>
  );
}
