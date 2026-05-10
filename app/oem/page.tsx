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

// PostgREST 기본 max-rows=1000. 더 크게 요청해도 잘려서 옴 → PAGE_SIZE를 1000으로 맞추고 페이지네이션.
const SUPABASE_PAGE_SIZE = 1000;

/** Supabase는 한 번 select에 max 1000행 반환 → range 페이지네이션으로 전체 fetch */
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
      logger.error({ err: error }, `${table} 조회 실패`);
      return all;
    }
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

export default async function OemPage() {
  const supabase = await createSupabaseServerClient();

  const [groupMonth, groupPtMonth, groupCountryMonth, typeSegMonth] = await Promise.all([
    fetchAll<OemSalesGroupMonth>(supabase, 'oem_sales_group_month'),
    fetchAll<OemSalesGroupPtMonth>(supabase, 'oem_sales_group_pt_month'),
    fetchAll<OemSalesGroupCountryMonth>(supabase, 'oem_sales_group_country_month'),
    fetchAll<OemSalesTypeSegMonth>(supabase, 'oem_sales_type_seg_month'),
  ]);

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
          groupCountryMonth={groupCountryMonth}
          typeSegMonth={typeSegMonth}
        />
      </div>
    </div>
  );
}
