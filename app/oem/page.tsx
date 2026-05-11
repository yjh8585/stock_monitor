import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import OemDashboard from '@/components/oem/OemDashboard';
import type { Database, TableRow } from '@/lib/database.types';
import type {
  OemSalesGroupCountryMonth,
  OemSalesGroupMonth,
  OemSalesGroupPtMonth,
  OemSalesTypeSegMonth,
} from '@/lib/types';

// PostgREST 기본 max-rows=1000. 페이지네이션으로 전체 fetch.
const SUPABASE_PAGE_SIZE = 1000;

const COUNTRY_TOP_N = 15;
const HEATMAP_TOP_N = 10;
const YEAR_2025_START = 202501;
const YEAR_2025_END = 202512;

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
  const countries = [...countryTotal.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, HEATMAP_TOP_N)
    .map(([n]) => n);
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

/** OEM 데이터 fetch + 사전 가공 — Cache Components 적용. cacheLife='hours'. */
async function getOemData() {
  'use cache';
  cacheLife('hours');
  cacheTag('oem_sales_group_month');
  cacheTag('oem_sales_group_pt_month');
  cacheTag('oem_sales_group_country_month');
  cacheTag('oem_sales_type_seg_month');

  const supabase = createSupabaseAnonClient();
  const [groupMonthRaw, groupPtMonthRaw, groupCountryMonthRaw, typeSegMonthRaw] =
    await Promise.all([
      fetchAll(supabase, 'oem_sales_group_month'),
      fetchAll(supabase, 'oem_sales_group_pt_month'),
      fetchAll(supabase, 'oem_sales_group_country_month'),
      fetchAll(supabase, 'oem_sales_type_seg_month'),
    ]);

  const groupMonth: OemSalesGroupMonth[] = groupMonthRaw;
  const groupPtMonth: OemSalesGroupPtMonth[] = groupPtMonthRaw;
  const groupCountryMonth: OemSalesGroupCountryMonth[] = groupCountryMonthRaw;
  const typeSegMonth: OemSalesTypeSegMonth[] = typeSegMonthRaw;

  // 117K 행 groupCountryMonth → 서버에서 작은 props 사전 가공 후 client 전달
  const countryTop15 = aggregateCountryTop15(groupCountryMonth);
  const oemCountryMatrix = aggregateOemCountryMatrix(groupCountryMonth);
  const oemGroupCount = new Set(groupMonth.map((r) => r.oem_group)).size;

  return { groupMonth, groupPtMonth, typeSegMonth, countryTop15, oemCountryMatrix, oemGroupCount };
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
        />
      </div>
    </div>
  );
}
