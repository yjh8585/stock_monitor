/**
 * 협력사(소싱 후보) 페이지 조회 계층 — 표 5종이 전부 사외비라 confidentialDb 로만 읽는다.
 * 점수는 저장하지 않고 조회 때마다 계산한다(결정 9 — score.ts). 순위 매기기는 ranking.ts(순수 함수).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';
import { affiliateHint, scoreSupplier } from './score';
import {
  escapeLike,
  firstWord,
  latestFetchedAt,
  narrowSupplier,
  rankSuppliers,
  type LinkRow,
  type RankedSupplier,
  type RawSupplierRow,
} from './ranking';
import type { CompetitorRow, PartGroupRow, Region, ScoreBreakdown, SupplierRow } from './types';

export type { RankedSupplier } from './ranking';

const PAGE = 1000;
/** `in` 목록 한 번에 넣는 개수 — URL 길이 상한 보호. */
const IN_CHUNK = 500;
/** 형제 거점 후보를 DB 에서 받는 상한(첫 단어 일치는 받은 뒤 다시 거른다). */
const SIBLING_LIMIT = 100;

const SUPPLIER_COLS =
  'id,source,name,country,region,address,homepage,established,sales_text,employees,certifications,product_categories,processes,parts_comments,delivers_oem,delivers_supplier,remarks,source_url,fetched_at';

export interface ProductTab {
  slug: string;
  name_ko: string;
}

export interface SupplierRanking {
  product: ProductTab;
  groups: PartGroupRow[];
  rows: RankedSupplier[]; // 본인 제외 · 총점 내림차순 · 동점은 이름순
  regionCounts: Record<Region, number>;
  fetchedAt: string | null; // 가장 최근 fetched_at
}

export interface SupplierDetail {
  supplier: SupplierRow;
  product: ProductTab;
  groups: PartGroupRow[];
  score: ScoreBreakdown;
  competitors: CompetitorRow[];
  affiliateNames: string[];
  siblings: Pick<SupplierRow, 'id' | 'name' | 'country'>[];
}

function fail(label: string, error: { message: string }): never {
  logger.error({ err: error }, `${label} 조회 실패`);
  throw new Error(`${label} 조회 실패: ${error.message}`);
}

/** `.range()` 페이지 반복 — 호출부가 PK(또는 유일 키) 전체로 `.order()` 를 건다(AGENTS.md: 조건은 「유일하다」). */
async function fetchAllPages<T>(
  label: string,
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(label, error);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** 모르는 source·region 행은 버리고 경고 한 줄(실명은 찍지 않는다 — id·값만). */
function narrowAll(raws: RawSupplierRow[]): SupplierRow[] {
  return raws.flatMap((r) => {
    const s = narrowSupplier(r);
    if (!s) {
      logger.warn(
        { id: r.id, source: r.source, region: r.region },
        'sourcing_suppliers 모르는 source·region — 행 제외'
      );
      return [];
    }
    return [s];
  });
}

async function fetchProduct(slug: string): Promise<(ProductTab & { id: number }) | null> {
  const { data, error } = await confidentialDb
    .from('sourcing_products')
    .select('id,slug,name_ko')
    .eq('slug', slug)
    .maybeSingle();
  if (error) fail('sourcing_products', error);
  return data;
}

async function fetchGroups(productId: number): Promise<PartGroupRow[]> {
  const { data, error } = await confidentialDb
    .from('sourcing_part_groups')
    .select(
      'id,product_id,slug,name_ko,display_order,bom_parts,ml_part_names,ml_processes,keywords'
    )
    .eq('product_id', productId)
    .order('display_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) fail('sourcing_part_groups', error);
  return data ?? [];
}

async function fetchCompetitors(productId: number): Promise<CompetitorRow[]> {
  const { data, error } = await confidentialDb
    .from('sourcing_competitors')
    .select('id,product_id,name,aliases')
    .eq('product_id', productId)
    .order('id', { ascending: true });
  if (error) fail('sourcing_competitors', error);
  return data ?? [];
}

async function fetchLinks(groupIds: number[]): Promise<LinkRow[]> {
  const parts = await Promise.all(
    chunks(groupIds, IN_CHUNK).map((ids) =>
      fetchAllPages('sourcing_supplier_links', (from, to) =>
        confidentialDb
          .from('sourcing_supplier_links')
          .select('supplier_id,part_group_id,competitor_id')
          .in('part_group_id', ids)
          .order('supplier_id', { ascending: true })
          .order('part_group_id', { ascending: true })
          .order('competitor_id', { ascending: true })
          .range(from, to)
      )
    )
  );
  return parts.flat();
}

async function fetchSuppliers(ids: number[]): Promise<SupplierRow[]> {
  const parts = await Promise.all(
    chunks(ids, IN_CHUNK).map((chunk) =>
      fetchAllPages('sourcing_suppliers', (from, to) =>
        confidentialDb
          .from('sourcing_suppliers')
          .select(SUPPLIER_COLS)
          .in('id', chunk)
          .order('id', { ascending: true })
          .range(from, to)
      )
    )
  );
  return narrowAll(parts.flat());
}

/** 상단 제품 탭 — display_order 순 · 이름·slug 만. */
export async function getSourcingProducts(): Promise<ProductTab[]> {
  'use cache';
  cacheLife('days');
  cacheTag('sourcing');
  const { data, error } = await confidentialDb
    .from('sourcing_products')
    .select('slug,name_ko')
    .order('display_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) fail('sourcing_products', error);
  return data ?? [];
}

/** 제품 → 품목군 → 경쟁사 → links → suppliers 순으로 읽고 점수·순위를 매긴다. 제품 slug 가 없으면 null. */
export async function getSupplierRanking(productSlug: string): Promise<SupplierRanking | null> {
  'use cache';
  cacheLife('days');
  cacheTag('sourcing');
  const product = await fetchProduct(productSlug);
  if (!product) return null;
  const [groups, comps] = await Promise.all([
    fetchGroups(product.id),
    fetchCompetitors(product.id),
  ]);
  const links = groups.length ? await fetchLinks(groups.map((g) => g.id)) : [];
  const supplierIds = [...new Set(links.map((l) => l.supplier_id))];
  const suppliers = supplierIds.length ? await fetchSuppliers(supplierIds) : [];
  const { rows, regionCounts } = rankSuppliers(suppliers, links, groups, comps);
  return {
    product: { slug: product.slug, name_ko: product.name_ko },
    groups,
    rows,
    regionCounts,
    fetchedAt: latestFetchedAt(suppliers),
  };
}

async function fetchSiblings(
  s: SupplierRow
): Promise<Pick<SupplierRow, 'id' | 'name' | 'country'>[]> {
  // SHORTCUT: 첫 단어 일치로 같은 그룹 거점을 추정 → MarkLines 그룹 정보가 생기면 그것으로
  const word = firstWord(s.name);
  if (!word) return [];
  const { data, error } = await confidentialDb
    .from('sourcing_suppliers')
    .select('id,name,country')
    .ilike('name', `${escapeLike(word)}%`)
    .neq('id', s.id)
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .limit(SIBLING_LIMIT);
  if (error) fail('sourcing_suppliers(siblings)', error);
  // 접두 일치(「Acme%」)는 「Acmeco」도 잡는다 — 첫 단어가 정확히 같은 것만 남긴다.
  const key = word.toLowerCase();
  return (data ?? []).filter((x) => firstWord(x.name)?.toLowerCase() === key);
}

/** 공급사 상세 — 제품 slug·공급사 id 중 하나라도 없거나 source·region 을 모르면 null. */
export async function getSupplierDetail(
  id: number,
  productSlug: string
): Promise<SupplierDetail | null> {
  'use cache';
  cacheLife('days');
  cacheTag('sourcing');
  const product = await fetchProduct(productSlug);
  if (!product) return null;
  const [groups, comps, raw] = await Promise.all([
    fetchGroups(product.id),
    fetchCompetitors(product.id),
    confidentialDb
      .from('sourcing_suppliers')
      .select(SUPPLIER_COLS)
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => (error ? fail('sourcing_suppliers', error) : data)),
  ]);
  if (!raw) return null;
  const [supplier] = narrowAll([raw]);
  if (!supplier) return null;

  const score = scoreSupplier(supplier, groups, comps);
  const hit = new Set(score.competitorIds);
  const compName = new Map(comps.map((c) => [c.id, c.name]));
  return {
    supplier,
    product: { slug: product.slug, name_ko: product.name_ko },
    groups,
    score,
    competitors: comps.filter((c) => hit.has(c.id)),
    affiliateNames: affiliateHint(supplier, comps).flatMap((cid) => compName.get(cid) ?? []),
    siblings: await fetchSiblings(supplier),
  };
}
