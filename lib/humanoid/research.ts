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
  summary: string | null;
  isDelta: boolean;
  isPeriodic: boolean;
  targetPrice: number | null;
  opinion: string | null;
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
  report: ResearchReportRow;
  /** 같은 (증권사, 대상) 의 다른 리포트 — 최신순, 자기 자신 제외 */
  siblings: ResearchReportRow[];
}

/**
 * 🔴 select() 는 **한 줄짜리 문자열 리터럴 하나**여야 한다.
 *    `+` 로 이어 붙이면 supabase-js 의 리터럴 타입 추론이 무너져 행 타입이
 *    GenericStringError 로 뭉개진다(2026-08-24 실측).
 */
const SELECT_COLUMNS =
  'id,kind,target_name,ticker,company_id,title,broker,published_at,pdf_url,view_count,summary,is_delta,is_periodic,target_price,opinion';

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
  summary: string | null;
  is_delta: boolean;
  is_periodic: boolean;
  target_price: number | null;
  opinion: string | null;
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
    summary: r.summary,
    isDelta: r.is_delta,
    isPeriodic: r.is_periodic,
    targetPrice: r.target_price,
    opinion: r.opinion,
  };
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
  const { data, error } = await supabase
    .from('research_reports')
    .select(SELECT_COLUMNS)
    .order('published_at', { ascending: false, nullsFirst: false });

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
    total: rows.length,
    summarized: rows.filter((r) => r.summary !== null).length,
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
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  const report = mapRow(data as unknown as RawRow);

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
