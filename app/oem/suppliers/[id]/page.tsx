import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';
import { seoulDate } from '@/lib/customers/format';
import { SCORE_WEIGHTS, matchesAlias } from '@/lib/sourcing/score';
import { getSourcingProducts, getSupplierDetail } from '@/lib/sourcing/source';
import type { CompetitorRow, MatchLevel, SupplierRow } from '@/lib/sourcing/types';
import { cn } from '@/lib/utils';

export const metadata = { title: '협력사' };

/** Cache Components 는 dynamic route 에 generateStaticParams 결과를 최소 1개 요구한다 — '0' 은 정수 검사에서 404 로 빠진다. */
export async function generateStaticParams() {
  return [{ id: '0' }];
}

type Param = string | string[] | undefined;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ product?: Param }>;
}

// SHORTCUT: 단계·인증·출처 라벨과 배지 색은 목록(SupplierRankingTable·page)과 같은 값을 여기 한 번 더 둔다
//   → 목록 파일을 고칠 수 있을 때 lib/sourcing 쪽 공용 상수로 모은다.
const LEVEL_LABEL: Record<MatchLevel, string> = {
  named: '품목 명시',
  category: '분류 일치',
  process: '공정만',
  none: '일치 없음',
};
const SOURCE_LABEL: Record<SupplierRow['source'], string> = {
  marklines: 'MarkLines',
  web: '웹 조사',
};
const BADGE = 'rounded px-1.5 py-0.5 text-[11px]';
const BADGE_COMPETITOR = cn(
  BADGE,
  'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
);
const BADGE_AFFILIATE = cn(
  BADGE,
  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
);
const BADGE_PLAIN = cn(BADGE, 'bg-muted text-foreground');
const EXTERNAL = 'text-blue-600 hover:underline dark:text-blue-400';
const DASH = <span className="text-muted-foreground">—</span>;

const WEIGHTS_NOTE = [
  `경쟁사 납품 1곳당 ${SCORE_WEIGHTS.perCompetitor}점(최대 ${SCORE_WEIGHTS.competitorCap})`,
  `품목 일치 ${LEVEL_LABEL.named} ${SCORE_WEIGHTS.match.named} / ${LEVEL_LABEL.category} ${SCORE_WEIGHTS.match.category} / ${LEVEL_LABEL.process} ${SCORE_WEIGHTS.match.process}(품목군 중 가장 높은 단계 하나)`,
  `인증 IATF 16949 ${SCORE_WEIGHTS.cert.iatf} / ISO 9001 만 ${SCORE_WEIGHTS.cert.iso9001}`,
  `규모 종업원 ${SCORE_WEIGHTS.size.map((b) => `${b.min.toLocaleString('ko-KR')}명+ ${b.points}`).join(' / ')}`,
  '지역은 점수 없음',
].join(' · ');

function first(v: Param): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 양의 정수 문자열만 id 로 받는다(「abc」·「1.5」·「-3」·「0」·너무 큰 수는 null). */
function parseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** http(s) 로 시작하는 값만 외부 링크로 쓴다 — 그 밖(「www.…」·javascript: 등)은 글자로. */
function httpUrl(v: string | null): string | null {
  return v && /^https?:\/\//i.test(v.trim()) ? v.trim() : null;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={EXTERNAL}>
      {children}
    </a>
  );
}

/** 납품처 이름이 걸린 경쟁사 — 점수(competitorHits)와 같은 별칭 판정(matchesAlias)을 쓴다. */
function competitorOf(name: string, comps: CompetitorRow[]): CompetitorRow | undefined {
  return comps.find((c) => c.aliases.some((a) => matchesAlias(name, a)));
}

function certLabel(points: number): string {
  if (points === SCORE_WEIGHTS.cert.iatf) return 'IATF 16949 보유';
  if (points === SCORE_WEIGHTS.cert.iso9001) return 'ISO 9001 만 보유';
  return 'IATF 16949·ISO 9001 없음';
}

function sizeReason(employees: number | null): string {
  if (employees == null) return '종업원 수 미상';
  const band = SCORE_WEIGHTS.size.find((b) => employees >= b.min);
  const n = `종업원 ${employees.toLocaleString('ko-KR')}명`;
  return band ? `${n} → ${band.min.toLocaleString('ko-KR')}명 이상 구간` : `${n} → 최소 구간 미만`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Badges({ items }: { items: string[] }) {
  if (!items.length) return DASH;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x) => (
        <span key={x} className={BADGE_PLAIN}>
          {x}
        </span>
      ))}
    </span>
  );
}

function DeliveryList({
  title,
  names,
  comps,
}: {
  title: string;
  names: string[];
  comps: CompetitorRow[];
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium">
        {title} <span className="text-muted-foreground">({names.length})</span>
      </h4>
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">없음</p>
      ) : (
        <ul className="columns-1 gap-6 text-sm sm:columns-2 lg:columns-3">
          {names.map((n, i) => {
            const c = competitorOf(n, comps);
            return (
              <li key={`${i}-${n}`} className="break-inside-avoid py-0.5">
                {c ? (
                  <>
                    <span className="font-semibold">{n}</span>{' '}
                    <span className={BADGE_COMPETITOR} title={c.name}>
                      경쟁사
                    </span>
                  </>
                ) : (
                  n
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const TH = 'w-28 px-3 py-1.5 text-left align-top text-xs font-normal text-muted-foreground';
const TD = 'px-3 py-1.5 align-top';

/** 협력사 상세 — 개요 · 생산 품목 · 납품처 · 점수 내역 · 같은 그룹 거점(사외비). 제목·탭은 app/oem/layout.tsx. */
export default async function SupplierDetailPage({ params, searchParams }: PageProps) {
  // layout 이 먼저 막지만, 사외비 조회 전에 페이지에서도 한 번 더 막는다(목록 page 와 같은 패턴).
  const user = await getCurrentUser();
  if (!user || !canAccess('/oem/suppliers', user.role)) redirect('/');

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) notFound();

  // 제품 고르기는 목록과 같은 규칙 — 없거나 모르는 slug 면 첫 제품.
  const products = await getSourcingProducts();
  if (products.length === 0) notFound();
  const productParam = first((await searchParams).product);
  const productSlug = (products.find((p) => p.slug === productParam) ?? products[0]).slug;

  const d = await getSupplierDetail(id, productSlug);
  if (!d) notFound();
  const { supplier: s, score, competitors, groups } = d;
  const homepage = httpUrl(s.homepage);
  const sourceUrl = httpUrl(s.source_url);
  const listHref = `/oem/suppliers?product=${encodeURIComponent(d.product.slug)}`;

  const overview: [string, React.ReactNode][] = [
    ['국가', s.country ?? DASH],
    ['지역', s.region],
    ['주소', s.address ?? DASH],
    [
      '홈페이지',
      homepage ? <ExternalLink href={homepage}>{homepage}</ExternalLink> : (s.homepage ?? DASH),
    ],
    ['설립', s.established ?? DASH],
    ['매출', s.sales_text ?? DASH],
    ['종업원', s.employees == null ? DASH : `${s.employees.toLocaleString('ko-KR')}명`],
    ['인증', <Badges key="cert" items={s.certifications} />],
  ];

  const scoreRows: [string, React.ReactNode, number][] = [
    [
      '경쟁사 납품',
      competitors.length ? competitors.map((c) => c.name).join(', ') : '납품처에 경쟁사 없음',
      score.competitorPoints,
    ],
    [
      '품목 일치',
      groups.length ? (
        <ul className="space-y-0.5">
          {groups.map((g) => (
            <li key={g.id}>
              {g.name_ko}: {LEVEL_LABEL[score.groupLevels[g.id] ?? 'none']}
            </li>
          ))}
        </ul>
      ) : (
        '품목군 없음'
      ),
      score.matchPoints,
    ],
    ['인증', certLabel(score.certPoints), score.certPoints],
    ['규모', sizeReason(s.employees), score.sizePoints],
  ];

  return (
    <div className="space-y-6 px-6 py-4">
      <div className="space-y-1">
        <Link href={listHref} className="text-sm text-primary hover:underline">
          ← 목록으로 ({d.product.name_ko})
        </Link>
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {s.name}
          {s.country && (
            <span className="text-sm font-normal text-muted-foreground">{s.country}</span>
          )}
          <span className="text-sm font-normal tabular-nums">점수 {score.total}</span>
          {competitors.map((c) => (
            <span key={c.id} className={BADGE_COMPETITOR}>
              {c.name}
            </span>
          ))}
          {d.affiliateNames.length > 0 && (
            <span className={BADGE_AFFILIATE}>계열 가능성: {d.affiliateNames.join(', ')}</span>
          )}
        </h2>
        <p className="text-xs text-muted-foreground">
          출처 {SOURCE_LABEL[s.source]} · 수집일 {seoulDate(s.fetched_at)}
        </p>
      </div>

      <Section title="개요">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <tbody>
              {overview.map(([k, v]) => (
                <tr key={k} className="border-t border-border first:border-t-0">
                  <th scope="row" className={TH}>
                    {k}
                  </th>
                  <td className={TD}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="생산 품목 · 공정">
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-start gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">품목 분류</span>
            <Badges items={s.product_categories} />
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">공정</span>
            <Badges items={s.processes} />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">품목 설명(원문)</span>
            {s.parts_comments.length ? (
              <ul className="list-disc space-y-0.5 pl-5">
                {s.parts_comments.map((x, i) => (
                  <li key={`${i}-${x}`}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">없음</p>
            )}
          </div>
        </div>
      </Section>

      <Section title="납품처">
        <div className="space-y-3">
          <DeliveryList title="완성차" names={s.delivers_oem} comps={competitors} />
          <DeliveryList title="부품사" names={s.delivers_supplier} comps={competitors} />
        </div>
      </Section>

      <Section title="점수 내역">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left whitespace-nowrap">항목</th>
                <th className="px-3 py-2 text-left">근거</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">점수</th>
              </tr>
            </thead>
            <tbody>
              {scoreRows.map(([k, why, pts]) => (
                <tr key={k} className="border-t border-border">
                  <td className={cn(TD, 'whitespace-nowrap')}>{k}</td>
                  <td className={TD}>{why}</td>
                  <td className={cn(TD, 'text-right tabular-nums')}>{pts}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold">
                <td className={TD}>합계</td>
                <td className={TD} />
                <td className={cn(TD, 'text-right tabular-nums')}>{score.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">배점: {WEIGHTS_NOTE}</p>
      </Section>

      <Section title="같은 그룹 거점 · 원문">
        <div className="space-y-2 text-sm">
          {d.siblings.length ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {d.siblings.map((x) => (
                <li key={x.id}>
                  {x.listed ? (
                    <Link
                      href={`/oem/suppliers/${x.id}?product=${encodeURIComponent(d.product.slug)}`}
                      className={EXTERNAL}
                    >
                      {x.name}
                    </Link>
                  ) : (
                    <span title="이 제품의 후보 목록에는 없는 거점">{x.name}</span>
                  )}
                  {x.country && <span className="text-muted-foreground"> · {x.country}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">같은 이름으로 시작하는 다른 거점 없음</p>
          )}
          <p className="text-xs text-muted-foreground">
            같은 그룹 거점은 이름 첫 단어가 같은 업체로 추정한 것입니다(링크 없는 거점은 이 제품의
            후보 목록에 없음).
          </p>
          <p>
            {sourceUrl ? (
              <ExternalLink href={sourceUrl}>{SOURCE_LABEL[s.source]} 원문 보기</ExternalLink>
            ) : (
              <span className="text-muted-foreground">원문 링크 없음</span>
            )}
          </p>
        </div>
      </Section>
    </div>
  );
}
