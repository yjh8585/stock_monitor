/**
 * OEM(/oem) 도메인 데이터 입구 — fetch + 'use cache' + aggregate 오케스트레이션.
 *
 * 페이지는 본 모듈의 `getOemData()`만 호출하면 된다. anon Supabase client 선택,
 * 6개 테이블 fetch, cache 메타데이터, 사전 가공(`./aggregate`) 호출까지 모두 격리.
 *
 * 사전 가공 4개 pure 함수는 `./aggregate`에 분리 — `aggregate.test.ts`로 단위 테스트.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import type { Database, TableRow } from '@/lib/database.types';
import type {
  OemModelOutlook,
  OemSalesGroupCountryMonth,
  OemSalesGroupMonth,
  OemSalesGroupPtMonth,
  OemSalesModelCountryMonth,
  OemSalesTypeSegMonth,
} from '@/lib/types';
import {
  aggregateCountryTop15,
  aggregateModelSeries,
  aggregateOemCountryMatrix,
  aggregateUsaOemSeries,
  NA_COUNTRY,
  NA_MODEL_TARGETS,
} from './aggregate';

const SUPABASE_PAGE_SIZE = 1000;

type AnonClient = ReturnType<typeof createSupabaseAnonClient>;

/** Supabase 한 번 select에 max 1000행 → range 페이지네이션 + 실패 시 throw. */
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

/** model_country_month 중 USA + 대상 모델만 fetch (전체 적재량 크면 필터 조건으로 가벼움). */
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

/** AI 평가 카드 최신본 — 모델별 최근 1건씩 fetch. */
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
  const seen = new Set<string>();
  const out: OemModelOutlook[] = [];
  for (const row of data as unknown as OemModelOutlook[]) {
    if (seen.has(row.model_key)) continue;
    seen.add(row.model_key);
    out.push(row);
  }
  return out;
}

/** OEM 페이지 props — 6개 테이블 fetch + 4개 사전 가공. Cache Components 적용 (cacheLife='hours'). */
export async function getOemData() {
  'use cache';
  cacheLife('hours');
  cacheTag('oem_sales_group_month');
  cacheTag('oem_sales_group_pt_month');
  cacheTag('oem_sales_group_country_month');
  cacheTag('oem_sales_type_seg_month');
  cacheTag('oem_sales_model_country_month');
  cacheTag('oem_model_outlook');

  const supabase = createSupabaseAnonClient();
  const [groupMonthRaw, groupPtMonthRaw, groupCountryMonthRaw, typeSegMonthRaw, modelRows, outlooks] =
    await Promise.all([
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
  const usaOemSeries = aggregateUsaOemSeries(groupCountryMonth);
  const naModelSeries = aggregateModelSeries(modelRows);
  const oemGroupCount = new Set(groupMonth.map((r) => r.oem_group)).size;

  return {
    groupMonth,
    groupPtMonth,
    typeSegMonth,
    countryTop15,
    oemCountryMatrix,
    usaOemSeries,
    naModelSeries,
    outlooks,
    oemGroupCount,
  };
}
