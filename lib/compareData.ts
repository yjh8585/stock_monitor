/**
 * 재무 비교 페이지(/compare) 데이터 액세스 (server-only, 'use cache').
 * 타입/상수는 client-safe인 lib/compareMetrics.ts에 두고 여기선 fetch만.
 *
 * 비교 대상은 companies.pages 배열에 'compare'가 포함된 회사 전체.
 * 회사를 추가하려면 DB에서 해당 회사의 pages에 'compare'를 추가하면 된다.
 */
import { cacheLife, cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';
import {
  type CompareCompany,
  type FinancialRow,
} from '@/lib/compareMetrics';

/** company_pages.page='compare' 매핑된 회사 메타 조회 (name_kr 오름차순) */
export async function getCompareCompanies(): Promise<CompareCompany[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('companies');
  const sb = createSupabaseAnonClient();
  const { data: mapping, error: mapErr } = await sb
    .from('company_pages')
    .select('company_id')
    .eq('page', 'compare');
  if (mapErr) {
    logger.error({ err: mapErr }, 'compare company_pages 조회 실패');
    return [];
  }
  const ids = (mapping ?? []).map((r) => r.company_id);
  if (ids.length === 0) return [];

  const { data, error } = await sb
    .from('companies')
    .select('id,name_kr')
    .in('id', ids)
    .order('name_kr', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'compare companies 조회 실패');
    return [];
  }
  return (data ?? []).map((r) => ({ id: r.id, name_kr: r.name_kr ?? '' }));
}

/** 4개사의 annual financials 행을 회사별 그룹으로 반환 (fiscal_year asc) */
export async function getCompareFinancials(
  companyIds: readonly string[]
): Promise<Record<string, FinancialRow[]>> {
  'use cache';
  cacheLife('hours');
  cacheTag('financials');
  if (companyIds.length === 0) return {};

  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('financials')
    .select(
      'company_id,fiscal_year,revenue,operating_income,cogs,sga,inventory,net_income,ebitda,total_assets,total_liabilities,total_equity,labor_cost'
    )
    .in('company_id', companyIds)
    .eq('period_type', 'annual')
    .is('fiscal_quarter', null)
    .order('fiscal_year', { ascending: true });

  if (error) {
    logger.error({ err: error }, 'compare financials 조회 실패');
    return {};
  }

  const result: Record<string, FinancialRow[]> = {};
  for (const r of data ?? []) {
    if (!result[r.company_id]) result[r.company_id] = [];
    result[r.company_id].push({
      fiscal_year: r.fiscal_year,
      revenue: r.revenue,
      operating_income: r.operating_income,
      cogs: r.cogs,
      sga: r.sga,
      inventory: r.inventory,
      net_income: r.net_income,
      ebitda: r.ebitda,
      total_assets: r.total_assets,
      total_liabilities: r.total_liabilities,
      total_equity: r.total_equity,
      labor_cost: r.labor_cost,
    });
  }
  return result;
}
