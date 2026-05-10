import { createSupabaseServerClient } from '@/lib/supabase/server';
import logger from '@/lib/logger';
import OemDashboard from '@/components/oem/OemDashboard';
import type {
  OemSalesGroupCountryMonth,
  OemSalesGroupMonth,
  OemSalesGroupPtMonth,
  OemSalesTypeSegMonth,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

// PostgREST 기본 max-rows=1000. 페이지네이션으로 전체 fetch.
const SUPABASE_PAGE_SIZE = 1000;

const COUNTRY_TOP_N = 15;
const HEATMAP_TOP_N = 10;
const YEAR_2025_START = 202501;
const YEAR_2025_END = 202512;

/** Supabase는 한 번 select에 max 1000행 반환 → range 페이지네이션 + 실패 시 throw */
async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string
): Promise<T[]> {
  const all: T[] = [];
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
    all.push(...(data as T[]));
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

export default async function OemPage() {
  const supabase = await createSupabaseServerClient();

  const [groupMonth, groupPtMonth, groupCountryMonth, typeSegMonth] = await Promise.all([
    fetchAll<OemSalesGroupMonth>(supabase, 'oem_sales_group_month'),
    fetchAll<OemSalesGroupPtMonth>(supabase, 'oem_sales_group_pt_month'),
    fetchAll<OemSalesGroupCountryMonth>(supabase, 'oem_sales_group_country_month'),
    fetchAll<OemSalesTypeSegMonth>(supabase, 'oem_sales_type_seg_month'),
  ]);

  // groupCountryMonth(117K행)는 서버에서 미리 사전 가공해 작은 props만 client에 전달
  const countryTop15 = aggregateCountryTop15(groupCountryMonth);
  const oemCountryMatrix = aggregateOemCountryMatrix(groupCountryMonth);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">글로벌 OEM 판매량 대시보드</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          MarkLines 글로벌 자동차 판매 데이터 · 2020.01~ ·{' '}
          {new Set(groupMonth.map((r) => r.oem_group)).size}개 OEM 그룹
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <OemDashboard
          groupMonth={groupMonth}
          groupPtMonth={groupPtMonth}
          typeSegMonth={typeSegMonth}
          countryTop15={countryTop15}
          oemCountryMatrix={oemCountryMatrix}
        />
      </div>
    </div>
  );
}
