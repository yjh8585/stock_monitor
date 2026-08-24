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
  total: number;
  summarized: number;
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
    return { groups: [], brokers: [], total: 0, summarized: 0 };
  }

  const rows = ((data ?? []) as unknown as RawRow[]).map(mapRow);
  const brokers = [...new Set(rows.map((r) => r.broker).filter((b): b is string => !!b))].sort();

  return {
    groups: groupReports(rows),
    brokers,
    total: rows.length,
    summarized: rows.filter((r) => r.summary !== null).length,
  };
}
