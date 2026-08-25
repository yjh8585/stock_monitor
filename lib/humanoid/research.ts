/**
 * 휴머노이드 > 증권사 리포트(/humanoid/research) 데이터 입구 — fetch + 'use cache' + 묶음 구성.
 *
 * 원천은 `research_reports`(네이버 증권 리서치). 수집은 scripts/collect_naver_research.py,
 * 요약은 scripts/summarize_naver_research.py 가 채운다.
 *
 * 묶음(그룹) 단위는 **(증권사, 대상)** 이다 — 같은 증권사가 같은 종목을 이어 다룬 흐름이라야
 * "직전 대비 무엇이 바뀌었나"(delta 요약)가 성립하기 때문이다. 화면도 그 단위로 접는다.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';

import { createSupabaseAnonClient } from '@/lib/supabase/anon';

/** 리포트 PDF 에서 뽑아 Storage 에 올린 차트·도표 한 장. */
export interface ResearchFigure {
  name: string;
  url: string;
  page: number;
  caption: string;
}

/**
 * 목록이 쓰는 행 — **본문(summary)을 담지 않는다.**
 *
 * 🔴 2026-08-25 에 요약 규격이 1,200자대에서 8,000자대로 커졌다. 목록은 리포트 144건을
 *    한꺼번에 실어 나르므로 본문을 담으면 캐시·클라이언트 payload 가 1MB 를 넘는다.
 *    이 프로젝트는 Vercel ISR Write 한도에 걸린 전력이 있다(`docs/isr-write-optimization.md`).
 *    그래서 목록에는 DB 생성컬럼 `summary_excerpt`(앞 800자)만 싣는다.
 */
export interface ResearchReportRow {
  id: string;
  kind: 'industry' | 'company';
  targetName: string;
  ticker: string | null;
  companyId: string | null;
  title: string;
  broker: string | null;
  publishedAt: string | null;
  pdfUrl: string | null;
  viewCount: number | null;
  /** 요약 앞부분. null 이면 아직 정리되지 않은 리포트다. */
  summaryExcerpt: string | null;
  isDelta: boolean;
  isPeriodic: boolean;
  targetPrice: number | null;
  opinion: string | null;
}

/** 상세가 쓰는 행 — 본문과 그림 목록이 붙는다. */
export interface ResearchReportFull extends ResearchReportRow {
  summary: string | null;
  images: ResearchFigure[];
}

export interface ResearchGroup {
  /** `${broker}|${targetName}` — 리스트 key 로 쓴다 */
  key: string;
  broker: string;
  targetName: string;
  ticker: string | null;
  /** 우리가 추적하는 휴머노이드 종목인가 */
  tracked: boolean;
  /** 가장 최근 리포트 */
  latest: ResearchReportRow;
  /** 그 아래 이력 (최신순, latest 제외) */
  history: ResearchReportRow[];
}

export interface ResearchData {
  groups: ResearchGroup[];
  /** 필터 드롭다운용 증권사 목록 */
  brokers: string[];
  /** 필터 드롭다운용 대상(종목·업종) 목록 — 리포트가 많은 순 (사용자 지시 2026-08-25) */
  targets: string[];
  total: number;
  summarized: number;
}

/** 상세 페이지가 쓰는 한 건 + 같은 묶음의 앞뒤 이력. */
export interface ResearchDetail {
  report: ResearchReportFull;
  /** 같은 (증권사, 대상) 의 다른 리포트 — 최신순, 자기 자신 제외. 본문은 안 싣는다. */
  siblings: ResearchReportRow[];
}

/**
 * 🔴 select() 는 **한 줄짜리 문자열 리터럴 하나**여야 한다.
 *    `+` 로 이어 붙이면 supabase-js 의 리터럴 타입 추론이 무너져 행 타입이
 *    GenericStringError 로 뭉개진다(2026-08-24 실측).
 */
/**
 * 새 규격 정리본의 표식 — 본문이 「> 한 줄 핵심 요약」 인용 블록으로 시작한다.
 * 옛 규격(2026-08-25 이전)은 `## 투자포인트` 로 시작했다.
 * 🔴 파이썬 쪽 `summarize_naver_research.is_current_format` 과 **같은 표식**이어야 한다 —
 *    갈리면 스크립트가 「정리됨」이라 여긴 것이 화면에서 사라진다.
 */
const CURATED_PREFIX = '>';

const SELECT_COLUMNS =
  'id,kind,target_name,ticker,company_id,title,broker,published_at,pdf_url,view_count,summary_excerpt,is_delta,is_periodic,target_price,opinion';

/** 상세용 — 위 컬럼에 본문과 그림 목록을 더한다. */
const SELECT_COLUMNS_FULL =
  'id,kind,target_name,ticker,company_id,title,broker,published_at,pdf_url,view_count,summary_excerpt,is_delta,is_periodic,target_price,opinion,summary,images';

interface RawRow {
  id: string;
  kind: string;
  target_name: string;
  ticker: string | null;
  company_id: string | null;
  title: string;
  broker: string | null;
  published_at: string | null;
  pdf_url: string | null;
  view_count: number | null;
  summary_excerpt: string | null;
  is_delta: boolean;
  is_periodic: boolean;
  target_price: number | null;
  opinion: string | null;
}

interface RawRowFull extends RawRow {
  summary: string | null;
  images: unknown;
}

function mapRow(r: RawRow): ResearchReportRow {
  return {
    id: r.id,
    kind: r.kind === 'company' ? 'company' : 'industry',
    targetName: r.target_name,
    ticker: r.ticker,
    companyId: r.company_id,
    title: r.title,
    broker: r.broker,
    publishedAt: r.published_at,
    pdfUrl: r.pdf_url,
    viewCount: r.view_count,
    summaryExcerpt: r.summary_excerpt,
    isDelta: r.is_delta,
    isPeriodic: r.is_periodic,
    targetPrice: r.target_price,
    opinion: r.opinion,
  };
}

/**
 * JSONB 그림 목록을 안전하게 읽는다.
 *
 * 🔴 JSONB 는 형태가 어긋날 수 있다(`lib/oem-competition` 과 같은 규칙) — 배열이 아니거나
 *    url 이 없는 항목은 버린다. 화면에서 깨진 이미지를 그리는 것보다 안 그리는 게 낫다.
 */
export function mapFigures(raw: unknown): ResearchFigure[] {
  if (!Array.isArray(raw)) return [];
  const figures: ResearchFigure[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    if (typeof f.url !== 'string' || f.url.length === 0) continue;
    figures.push({
      name: typeof f.name === 'string' ? f.name : '',
      url: f.url,
      page: typeof f.page === 'number' ? f.page : 0,
      caption: typeof f.caption === 'string' ? f.caption : '',
    });
  }
  return figures;
}

function mapRowFull(r: RawRowFull): ResearchReportFull {
  return { ...mapRow(r), summary: r.summary, images: mapFigures(r.images) };
}

/** 행 목록을 (증권사, 대상) 묶음으로 접는다. 각 묶음 안은 최신순. */
export function groupReports(rows: ResearchReportRow[]): ResearchGroup[] {
  const byKey = new Map<string, ResearchReportRow[]>();

  for (const row of rows) {
    const broker = row.broker ?? '(미상)';
    const key = `${broker}|${row.targetName}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  const groups: ResearchGroup[] = [];
  for (const [key, bucket] of byKey) {
    // 발행일 내림차순. 날짜가 없는 것은 뒤로 민다.
    bucket.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    const [latest, ...history] = bucket;
    if (!latest) continue;
    groups.push({
      key,
      broker: latest.broker ?? '(미상)',
      targetName: latest.targetName,
      ticker: latest.ticker,
      tracked: bucket.some((r) => r.companyId !== null),
      latest,
      history,
    });
  }

  // 묶음끼리도 최신순 — 방금 나온 리포트가 위로 온다.
  groups.sort((a, b) => (b.latest.publishedAt ?? '').localeCompare(a.latest.publishedAt ?? ''));
  return groups;
}

/** `research_reports` 전량 fetch — Cache Components 적용 (cacheLife='hours'). */
export async function getResearchData(): Promise<ResearchData> {
  'use cache';
  cacheLife('hours');
  cacheTag('research_reports');

  const supabase = createSupabaseAnonClient();

  // 🔴 새 규격으로 정리된 것만 목록에 올린다(사용자 선택 2026-08-25 "목록에서 숨긴다").
  //    판정은 정리본이 「> 한 줄 핵심 요약」 인용 블록으로 시작하는지 — 옛 규격은
  //    `## 투자포인트` 로 시작한다(파이썬 쪽 `is_current_format` 과 같은 표식).
  //    부수 효과로 payload 도 줄어든다(144행 → 정리된 것만).
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from('research_reports')
      .select(SELECT_COLUMNS)
      .like('summary_excerpt', `${CURATED_PREFIX}%`)
      .order('published_at', { ascending: false, nullsFirst: false }),
    supabase.from('research_reports').select('id', { count: 'exact', head: true }),
  ]);

  if (error) {
    // 화면을 통째로 죽이지 않는다 — 빈 목록으로 떨어뜨리고 로그만 남긴다.
    return { groups: [], brokers: [], targets: [], total: 0, summarized: 0 };
  }

  const rows = ((data ?? []) as unknown as RawRow[]).map(mapRow);
  const brokers = [...new Set(rows.map((r) => r.broker).filter((b): b is string => !!b))].sort();

  return {
    groups: groupReports(rows),
    brokers,
    targets: listTargets(rows),
    // total 은 수집된 전량, summarized 는 그중 화면에 오른 것 — 「144건 중 60건 정리」로 읽힌다.
    total: count ?? rows.length,
    summarized: rows.length,
  };
}

/**
 * 대상(종목·업종) 드롭다운 목록. 리포트가 많은 순 → 같으면 가나다순.
 *
 * 증권사 드롭다운처럼 단순 가나다순으로 두면 리포트 1건짜리 종목 수십 개 사이에서
 * 정작 자주 다뤄지는 종목을 못 찾는다.
 */
export function listTargets(rows: ResearchReportRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.targetName, (counts.get(r.targetName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([name]) => name);
}

/** 리포트 한 건 + 같은 (증권사, 대상) 묶음의 다른 회차. 없으면 null. */
export async function getResearchDetail(id: string): Promise<ResearchDetail | null> {
  'use cache';
  cacheLife('hours');
  cacheTag('research_reports');

  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase
    .from('research_reports')
    .select(SELECT_COLUMNS_FULL)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  const report = mapRowFull(data as unknown as RawRowFull);

  // 같은 증권사가 같은 대상을 이어 다룬 회차 — 상세 하단의 "이전 리포트".
  const { data: sibData } = await supabase
    .from('research_reports')
    .select(SELECT_COLUMNS)
    .eq('target_name', report.targetName)
    .order('published_at', { ascending: false, nullsFirst: false });

  const siblings = ((sibData ?? []) as unknown as RawRow[])
    .map(mapRow)
    .filter((r) => r.id !== report.id && r.broker === report.broker);

  return { report, siblings };
}
