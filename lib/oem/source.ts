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
  OemCountryGroupYear,
  OemSalesGroupMonth,
  OemSalesGroupPtMonth,
  OemSalesModelCountryMonth,
  OemSalesTypeSegMonth,
  OemUsaGroupMonth,
} from '@/lib/types';
import {
  aggregateCountryTop15,
  aggregateModelSeries,
  aggregateOemCountryMatrix,
  aggregateOtherModelSeries,
  aggregateUsaOemSeries,
  NA_COUNTRY,
  NA_MODEL_TARGETS,
  OTHER_MODEL_TARGETS,
  TARGET_YEAR,
} from './aggregate';

const SUPABASE_PAGE_SIZE = 1000;
// 나머지 페이지 병렬 fetch 상한 (Supabase 커넥션 보호 + 프리렌더 타임아웃 여유)
const FETCH_CONCURRENCY = 8;

type AnonClient = ReturnType<typeof createSupabaseAnonClient>;

/**
 * Supabase 한 번 select에 max 1000행. 첫 페이지에서 총행수(count)를 얻고
 * 나머지 페이지를 배치 병렬로 fetch → 대용량 테이블의 순차 왕복 지연 제거.
 * 실패 시 throw. (aggregate는 키 그룹화라 페이지 순서 무관)
 */
async function fetchAll<TName extends keyof Database['public']['Tables']>(
  supabase: AnonClient,
  table: TName
): Promise<TableRow<TName>[]> {
  const first = await supabase
    .from(table)
    .select('*', { count: 'exact' })
    .range(0, SUPABASE_PAGE_SIZE - 1);
  if (first.error) {
    logger.error({ err: first.error, table }, `${table} 조회 실패`);
    throw new Error(`Supabase ${table} 조회 실패: ${first.error.message}`);
  }
  const all = (first.data ?? []) as unknown as TableRow<TName>[];
  const total = first.count ?? all.length;
  if (total <= SUPABASE_PAGE_SIZE) return all;

  const pageCount = Math.ceil(total / SUPABASE_PAGE_SIZE);
  for (let start = 1; start < pageCount; start += FETCH_CONCURRENCY) {
    const batch = [];
    for (let page = start; page < Math.min(start + FETCH_CONCURRENCY, pageCount); page++) {
      const offset = page * SUPABASE_PAGE_SIZE;
      batch.push(
        supabase
          .from(table)
          .select('*')
          .range(offset, offset + SUPABASE_PAGE_SIZE - 1)
      );
    }
    const results = await Promise.all(batch);
    for (const { data, error } of results) {
      if (error) {
        logger.error({ err: error, table }, `${table} 조회 실패`);
        throw new Error(`Supabase ${table} 조회 실패: ${error.message}`);
      }
      all.push(...((data ?? []) as unknown as TableRow<TName>[]));
    }
  }
  return all;
}

/**
 * model_country_month 중 지정 모델만 fetch. `country` 지정 시 해당 국가로 추가 필터,
 * 미지정 시 전 국가. 모델 집합이 작아 필터 조건으로 가볍다.
 *
 * `.range()` 페이지네이션은 반드시 **결정적 전체 정렬**과 함께 써야 한다. `.in()` 필터는
 * 인덱스 스캔을 타서 ORDER BY 없이는 페이지 경계에서 순서가 흔들려 행이 누락·중복된다
 * (전 국가 fetch가 1000행을 넘길 때 특정 연도가 통째로 빠지는 증상). PK 4컬럼으로 정렬해 고정.
 */
async function fetchModelRows(
  supabase: AnonClient,
  models: string[],
  country?: string
): Promise<OemSalesModelCountryMonth[]> {
  const out: OemSalesModelCountryMonth[] = [];
  let from = 0;
  while (true) {
    let query = supabase
      .from('oem_sales_model_country_month')
      .select('*')
      .in('model', models)
      .order('oem_group')
      .order('country')
      .order('model')
      .order('year_month');
    if (country) query = query.eq('country', country);
    const { data, error } = await query.range(from, from + SUPABASE_PAGE_SIZE - 1);
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

/**
 * oem_sales_country_group_year 뷰 — 지정 연도만 fetch (국가 TOP15/매트릭스용).
 * DB가 연·OEM·국가로 사전 집계한 소량(연 ~2천 행)만 받아 프리렌더 부담을 제거한다.
 * `.range()` 다중 페이지는 결정적 정렬 필수 → 뷰 유니크 키(oem_group, country)로 정렬.
 */
async function fetchCountryGroupYear(
  supabase: AnonClient,
  year: number
): Promise<OemCountryGroupYear[]> {
  const out: OemCountryGroupYear[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('oem_sales_country_group_year')
      .select('*')
      .eq('year', year)
      .order('oem_group')
      .order('country')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'oem_sales_country_group_year 조회 실패');
      throw new Error(`Supabase oem_sales_country_group_year 조회 실패: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as OemCountryGroupYear[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return out;
}

/**
 * oem_sales_usa_group_month 뷰 — 전체 기간 fetch (미국 TOP10 OEM 월별 시계열용).
 * USA만·OEM×월 사전 집계라 ~2천 행. 정렬(oem_group, year_month)로 결정적 페이지네이션.
 */
async function fetchUsaGroupMonth(supabase: AnonClient): Promise<OemUsaGroupMonth[]> {
  const out: OemUsaGroupMonth[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('oem_sales_usa_group_month')
      .select('*')
      .order('oem_group')
      .order('year_month')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'oem_sales_usa_group_month 조회 실패');
      throw new Error(`Supabase oem_sales_usa_group_month 조회 실패: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as OemUsaGroupMonth[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return out;
}

/** OEM 페이지 props — 6개 테이블 fetch + 4개 사전 가공. Cache Components 적용 (cacheLife='days', 수집 시 무효화). */
export async function getOemData() {
  'use cache';
  cacheLife('days');
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
    countryGroupYearRows,
    usaGroupMonthRows,
    typeSegMonthRaw,
    modelRows,
    otherModelRows,
  ] = await Promise.all([
    fetchAll(supabase, 'oem_sales_group_month'),
    fetchAll(supabase, 'oem_sales_group_pt_month'),
    fetchCountryGroupYear(supabase, TARGET_YEAR),
    fetchUsaGroupMonth(supabase),
    fetchAll(supabase, 'oem_sales_type_seg_month'),
    fetchModelRows(
      supabase,
      NA_MODEL_TARGETS.flatMap((t) => t.models),
      NA_COUNTRY
    ),
    fetchModelRows(
      supabase,
      OTHER_MODEL_TARGETS.flatMap((t) => t.models)
    ),
  ]);

  const groupMonth: OemSalesGroupMonth[] = groupMonthRaw;
  const groupPtMonth: OemSalesGroupPtMonth[] = groupPtMonthRaw;
  const typeSegMonth: OemSalesTypeSegMonth[] = typeSegMonthRaw;

  // 대용량 country×month(약 12만 행)는 DB 집계 뷰(oem_sales_country_group_year·
  // oem_sales_usa_group_month)로 사전 집계 → 여기선 작은 props로 마무리 가공.
  const countryTop15 = aggregateCountryTop15(countryGroupYearRows);
  const oemCountryMatrix = aggregateOemCountryMatrix(countryGroupYearRows);
  const usaOemSeries = aggregateUsaOemSeries(usaGroupMonthRows);
  const naModelSeries = aggregateModelSeries(modelRows);
  const otherModelSeries = aggregateOtherModelSeries(otherModelRows);
  const oemGroupCount = new Set(groupMonth.map((r) => r.oem_group)).size;

  return {
    groupMonth,
    groupPtMonth,
    typeSegMonth,
    countryTop15,
    oemCountryMatrix,
    usaOemSeries,
    naModelSeries,
    otherModelSeries,
    oemGroupCount,
  };
}
