/**
 * companies 마스터 도메인 데이터 입구 — fetch + 'use cache' + mapping.
 *
 * `/management/companies` 페이지가 호출. 신규 회사 INSERT 후 revalidateTag('companies')로
 * 자동 stale.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import type { TableRow } from '@/lib/database.types';

export type CompanyListItem = Pick<
  TableRow<'companies'>,
  | 'id'
  | 'ticker'
  | 'name'
  | 'name_kr'
  | 'country'
  | 'currency'
  | 'market'
  | 'data_source'
  | 'company_type'
  | 'region'
  | 'group_name'
  | 'status'
  | 'last_updated_at'
>;

/** active 회사 전체 list — 마스터 관리 페이지용 (검색·필터는 client-side). */
export async function getCompaniesList(): Promise<CompanyListItem[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('companies');

  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase
    .from('companies')
    .select(
      'id,ticker,name,name_kr,country,currency,market,data_source,company_type,region,group_name,status,last_updated_at'
    )
    .eq('status', 'active')
    .order('country', { ascending: true })
    .order('name_kr', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'companies 목록 조회 실패');
    throw new Error(`Supabase companies 조회 실패: ${error.message}`);
  }
  return (data ?? []) as CompanyListItem[];
}
