/**
 * 협력사 순위·행 좁히기 — DB 를 타지 않는 순수 함수(source.ts 가 조회 뒤 부른다 · ranking.test.ts).
 */
import { affiliateHint, isCompetitorSelf, scoreSupplier } from './score';
import {
  REGIONS,
  type CompetitorRow,
  type PartGroupRow,
  type Region,
  type ScoreBreakdown,
  type SupplierRow,
} from './types';

export interface RankedSupplier {
  supplier: Pick<
    SupplierRow,
    'id' | 'name' | 'country' | 'region' | 'employees' | 'sales_text' | 'certifications' | 'source'
  >;
  score: ScoreBreakdown;
  competitorNames: string[];
  affiliateNames: string[];
  groupIds: number[]; // links 로 걸린 품목군
}

export interface LinkRow {
  supplier_id: number;
  part_group_id: number;
  competitor_id: number | null;
}

/** DB 행 — `source`·`region` 이 아직 좁혀지지 않은 문자열. */
export type RawSupplierRow = Omit<SupplierRow, 'source' | 'region'> & {
  source: string;
  region: string;
};

const SOURCES: readonly SupplierRow['source'][] = ['marklines', 'web'];

export function isRegion(v: string): v is Region {
  return (REGIONS as readonly string[]).includes(v);
}

export function isSupplierSource(v: string): v is SupplierRow['source'] {
  return (SOURCES as readonly string[]).includes(v);
}

/** 모르는 `source`·`region` 이면 null — 호출부가 그 행을 버리고 경고를 남긴다. */
export function narrowSupplier(raw: RawSupplierRow): SupplierRow | null {
  const { source, region } = raw;
  if (!isSupplierSource(source) || !isRegion(region)) return null;
  return { ...raw, source, region };
}

export function emptyRegionCounts(): Record<Region, number> {
  return Object.fromEntries(REGIONS.map((r) => [r, 0])) as Record<Region, number>;
}

/**
 * 본인(경쟁사 자신) 제외 → 점수 → 총점 내림차순 · 동점은 이름순(그래도 같으면 id 순).
 * regionCounts 는 제외한 뒤의 행으로 센다(결정 10).
 */
export function rankSuppliers(
  suppliers: SupplierRow[],
  links: LinkRow[],
  groups: PartGroupRow[],
  comps: CompetitorRow[]
): { rows: RankedSupplier[]; regionCounts: Record<Region, number> } {
  const compName = new Map(comps.map((c) => [c.id, c.name]));
  const groupsOf = new Map<number, Set<number>>();
  for (const l of links) {
    const set = groupsOf.get(l.supplier_id) ?? new Set<number>();
    set.add(l.part_group_id);
    groupsOf.set(l.supplier_id, set);
  }

  const rows: RankedSupplier[] = [];
  for (const s of suppliers) {
    if (isCompetitorSelf(s, comps)) continue;
    const score = scoreSupplier(s, groups, comps);
    rows.push({
      supplier: {
        id: s.id,
        name: s.name,
        country: s.country,
        region: s.region,
        employees: s.employees,
        sales_text: s.sales_text,
        certifications: s.certifications,
        source: s.source,
      },
      score,
      competitorNames: score.competitorIds.flatMap((id) => compName.get(id) ?? []),
      affiliateNames: affiliateHint(s, comps).flatMap((id) => compName.get(id) ?? []),
      groupIds: [...(groupsOf.get(s.id) ?? [])].sort((a, b) => a - b),
    });
  }

  rows.sort(
    (a, b) =>
      b.score.total - a.score.total ||
      a.supplier.name.localeCompare(b.supplier.name, 'en') ||
      a.supplier.id - b.supplier.id
  );

  const regionCounts = emptyRegionCounts();
  for (const r of rows) regionCounts[r.supplier.region] += 1;
  return { rows, regionCounts };
}

/**
 * 이 제품의 목록에 오르는 업체인가 — 경쟁사 본인이 아니고, 이 제품 품목군에 걸린 links 가 하나라도 있다.
 * 목록(rankSuppliers 는 links 로 모은 업체에서 본인을 뺀다)과 같은 기준으로 상세를 막는다 —
 * 목록에서 빠진 업체가 주소를 고쳐 쳐서 상세에 뜨지 않게(source.ts getSupplierDetail).
 */
export function isListedSupplier(
  s: Pick<SupplierRow, 'id' | 'name'>,
  comps: CompetitorRow[],
  links: Pick<LinkRow, 'supplier_id' | 'part_group_id'>[],
  groups: Pick<PartGroupRow, 'id'>[]
): boolean {
  if (isCompetitorSelf(s, comps)) return false;
  const groupIds = new Set(groups.map((g) => g.id));
  return links.some((l) => l.supplier_id === s.id && groupIds.has(l.part_group_id));
}

/** 가장 최근 fetched_at(원문 문자열 그대로) — 행이 없으면 null. 시간대 표기가 섞여도 되게 시각으로 비교한다. */
export function latestFetchedAt(suppliers: Pick<SupplierRow, 'fetched_at'>[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const s of suppliers) {
    const ms = Date.parse(s.fetched_at);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = s.fetched_at;
    }
  }
  return best;
}

/** 이름 첫 단어(앞뒤 쉼표·마침표 제거). 3자 미만이면 null — 형제 거점 추정에 쓰기엔 너무 흔하다. */
export function firstWord(name: string): string | null {
  const w = (name.trim().split(/\s+/)[0] ?? '').replace(/^[,.]+|[,.]+$/g, '');
  return w.length >= 3 ? w : null;
}

/** LIKE 패턴용 이스케이프 — `\`·`%`·`_` 를 글자 그대로 맞추게 한다(Postgres 기본 이스케이프 문자 = `\`). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}
