import { redirect } from 'next/navigation';
import SupplierFilters from '@/components/oem/suppliers/SupplierFilters';
import SupplierRankingTable, {
  type SupplierTableRow,
} from '@/components/oem/suppliers/SupplierRankingTable';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';
import { seoulDate } from '@/lib/customers/format';
import { emptyRegionCounts, isRegion } from '@/lib/sourcing/ranking';
import { SCORE_WEIGHTS } from '@/lib/sourcing/score';
import {
  getSourcingProducts,
  getSupplierRanking,
  type RankedSupplier,
} from '@/lib/sourcing/source';

export const metadata = { title: '협력사' };

/** 표에 그리는 행 상한 — 넘으면 「N곳 중 200곳 표시」. */
const TABLE_LIMIT = 200;

const NOTICE =
  '경쟁사에 어떤 품목을 납품하는지는 MarkLines 에 없어, 납품처와 생산 품목을 겹쳐 추정한 결과입니다.';

type Param = string | string[] | undefined;

interface PageProps {
  searchParams: Promise<{ product?: Param; region?: Param; group?: Param }>;
}

function first(v: Param): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function certLabel(points: number): string | null {
  if (points === SCORE_WEIGHTS.cert.iatf) return 'IATF 16949';
  if (points === SCORE_WEIGHTS.cert.iso9001) return 'ISO 9001';
  return null;
}

/** client 표로 넘길 얇은 행 — groupLevels 처럼 표에 안 쓰는 칸은 브라우저로 보내지 않는다. */
function toTableRow(r: RankedSupplier): SupplierTableRow {
  return {
    id: r.supplier.id,
    name: r.supplier.name,
    country: r.supplier.country,
    total: r.score.total,
    bestLevel: r.score.bestLevel,
    employees: r.supplier.employees,
    cert: certLabel(r.score.certPoints),
    source: r.supplier.source,
    competitorNames: r.competitorNames,
    affiliateNames: r.affiliateNames,
  };
}

function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center text-base text-muted-foreground">{text}</div>;
}

/** 협력사(소싱 후보) 목록 — 제품·지역·품목군으로 거른 순위표(사외비). 제목·탭은 app/oem/layout.tsx. */
export default async function SuppliersPage({ searchParams }: PageProps) {
  // layout 이 먼저 막지만, 사외비 조회 전에 페이지에서도 한 번 더 막는다(app/customers 와 같은 패턴).
  const user = await getCurrentUser();
  if (!user || !canAccess('/oem/suppliers', user.role)) redirect('/');

  const products = await getSourcingProducts();
  if (products.length === 0) return <Empty text="아직 수집 전입니다." />;

  const sp = await searchParams;
  const productParam = first(sp.product);
  const product = products.find((p) => p.slug === productParam) ?? products[0];
  const ranking = await getSupplierRanking(product.slug);
  if (!ranking) return <Empty text="아직 수집 전입니다." />;

  // 거르기는 여기서 한다 — 캐시 함수 인자로 넘기면 조합마다 캐시 엔트리가 늘어난다.
  const regionParam = first(sp.region);
  const region = regionParam && isRegion(regionParam) ? regionParam : null;
  // 🔴 현재 제품의 품목군 id 일 때만 쓴다 — 없는 id 면 groupLevels[id] 가 undefined 라 모든 행이 통과한다.
  const groupNum = Number(first(sp.group));
  const group = ranking.groups.some((g) => g.id === groupNum) ? groupNum : null;

  const byGroup =
    group === null
      ? ranking.rows
      : ranking.rows.filter(
          (r) => r.groupIds.includes(group) || (r.score.groupLevels[group] ?? 'none') !== 'none'
        );
  // 지역 탭 건수는 품목군으로 거른 뒤 센다 — 품목군을 골라도 「지역 건수 합 = 전체」가 맞게.
  const regionCounts = emptyRegionCounts();
  for (const r of byGroup) regionCounts[r.supplier.region] += 1;
  const filtered = region === null ? byGroup : byGroup.filter((r) => r.supplier.region === region);
  // SHORTCUT: 200행 상한 → 필요하면 페이지 넘김
  const tableRows = filtered.slice(0, TABLE_LIMIT).map(toTableRow);

  return (
    <div className="space-y-3 px-6 py-4">
      <div className="space-y-0.5">
        <p className="text-sm text-muted-foreground">{NOTICE}</p>
        <p className="text-xs text-muted-foreground">
          MarkLines 기준일: {ranking.fetchedAt ? seoulDate(ranking.fetchedAt) : '수집 전'}
        </p>
      </div>
      <SupplierFilters
        state={{ product: product.slug, region, group }}
        products={products}
        groups={ranking.groups.map((g) => ({ id: g.id, name_ko: g.name_ko }))}
        regionCounts={regionCounts}
        total={byGroup.length}
      />
      {ranking.rows.length === 0 ? (
        <Empty text="아직 수집된 협력사가 없습니다." />
      ) : filtered.length === 0 ? (
        <Empty text="조건에 맞는 협력사가 없습니다." />
      ) : (
        <SupplierRankingTable rows={tableRows} total={filtered.length} productSlug={product.slug} />
      )}
    </div>
  );
}
