/**
 * 한세 대시보드(/app/hansae) 서버 데이터 로더.
 * 모두 service_role을 쓰지 않고 anon으로 충분(읽기 전용 + RLS anon read 허용).
 */
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';

export const HANSAE_TICKERS = ['016450', '105630', '069640'] as const;
export type HansaeTicker = (typeof HANSAE_TICKERS)[number];

export interface HansaeCompany {
  id: string;
  ticker: string;
  name_kr: string;
  market: string | null;
  lastPrice: number | null;
  lastChangePct: number | null;
  lastVolume: number | null;
  lastUpdatedAt: string | null;
}

export interface IntradayPoint {
  ts: string;
  price: number;
  changePct: number | null;
  volume: number | null;
}

export interface BoardPostSummary {
  postId: string;
  postedAt: string;
  title: string;
  views: number;
  likes: number;
  dislikes: number;
  label: 'positive' | 'negative' | 'neutral' | null;
  score: number | null;
  reason: string | null;
}

export interface SentimentSummary {
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

export interface SupplyDemandRow {
  tradeDate: string;
  foreignNet: number | null;
  institutionNet: number | null;
  individualNet: number | null;
}

export async function getHansaeCompanies(): Promise<HansaeCompany[]> {
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('companies')
    .select('id,ticker,name_kr,market,last_price,last_change_pct,last_volume,last_updated_at')
    .in('ticker', HANSAE_TICKERS as unknown as string[])
    .order('name_kr', { ascending: true });
  if (error) {
    logger.error({ err: error }, '한세 companies 조회 실패');
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      ticker: row.ticker as string,
      name_kr: (row.name_kr as string) ?? '',
      market: row.market as string | null,
      lastPrice: row.last_price as number | null,
      lastChangePct: row.last_change_pct as number | null,
      lastVolume: row.last_volume as number | null,
      lastUpdatedAt: row.last_updated_at as string | null,
    };
  });
}

/** 종목별 당일 5분봉 — KST 오늘 00:00 이후 데이터 */
export async function getIntradayQuotes(companyId: string): Promise<IntradayPoint[]> {
  const sb = createSupabaseAnonClient();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0); // KST 09:00 ≈ UTC 00:00, 충분히 안전 마진
  const { data, error } = await sb
    .from('stock_quotes_5min')
    .select('ts,price,change_pct,volume')
    .eq('company_id', companyId)
    .gte('ts', start.toISOString())
    .order('ts', { ascending: true });
  if (error) {
    logger.error({ err: error, companyId }, 'intraday 조회 실패');
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      ts: row.ts as string,
      price: Number(row.price),
      changePct: row.change_pct === null ? null : Number(row.change_pct),
      volume: row.volume === null ? null : Number(row.volume),
    };
  });
}

/** 종목별 최근 N개 토론 글 + 감성 결과 (글/감성 분리 쿼리 후 메모리에서 join) */
export async function getRecentBoardPosts(
  companyId: string,
  limit = 15
): Promise<BoardPostSummary[]> {
  const sb = createSupabaseAnonClient();
  const { data: posts, error: pErr } = await sb
    .from('naver_board_posts')
    .select('post_id,posted_at,title,views,likes,dislikes')
    .eq('company_id', companyId)
    .order('posted_at', { ascending: false })
    .limit(limit);
  if (pErr) {
    logger.error({ err: pErr, companyId }, '종목토론 조회 실패');
    return [];
  }
  const rows = posts ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.post_id);
  const { data: sentiments } = await sb
    .from('board_sentiment')
    .select('post_id,label,score,reason')
    .eq('company_id', companyId)
    .in('post_id', ids);
  const sentimentMap = new Map<
    string,
    { label: string; score: number | null; reason: string | null }
  >();
  for (const s of sentiments ?? []) {
    sentimentMap.set(s.post_id, { label: s.label, score: s.score, reason: s.reason });
  }

  return rows.map((r) => {
    const s = sentimentMap.get(r.post_id);
    const label =
      s?.label === 'positive' || s?.label === 'negative' || s?.label === 'neutral' ? s.label : null;
    return {
      postId: r.post_id,
      postedAt: r.posted_at,
      title: r.title,
      views: Number(r.views ?? 0),
      likes: Number(r.likes ?? 0),
      dislikes: Number(r.dislikes ?? 0),
      label,
      score: s?.score === undefined || s?.score === null ? null : Number(s.score),
      reason: s?.reason ?? null,
    };
  });
}

/** 종목별 최근 7일치 감성 비율 */
export async function getSentimentSummary(
  companyId: string,
  sinceDays = 7
): Promise<SentimentSummary> {
  const sb = createSupabaseAnonClient();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60_000).toISOString();
  const { data, error } = await sb
    .from('board_sentiment')
    .select('label,analyzed_at')
    .eq('company_id', companyId)
    .gte('analyzed_at', since);
  if (error) {
    logger.error({ err: error, companyId }, '감성 집계 조회 실패');
    return { positive: 0, negative: 0, neutral: 0, total: 0 };
  }
  const summary: SentimentSummary = { positive: 0, negative: 0, neutral: 0, total: 0 };
  for (const r of data ?? []) {
    const label = (r as { label: string }).label;
    if (label === 'positive') summary.positive += 1;
    else if (label === 'negative') summary.negative += 1;
    else summary.neutral += 1;
    summary.total += 1;
  }
  return summary;
}

/** 종목별 최근 N거래일 수급 */
export async function getRecentSupplyDemand(
  companyId: string,
  days = 5
): Promise<SupplyDemandRow[]> {
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('stock_supply_demand')
    .select('trade_date,foreign_net,institution_net,individual_net')
    .eq('company_id', companyId)
    .order('trade_date', { ascending: false })
    .limit(days);
  if (error) {
    logger.error({ err: error, companyId }, '수급 조회 실패');
    return [];
  }
  return (data ?? [])
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        tradeDate: row.trade_date as string,
        foreignNet: row.foreign_net === null ? null : Number(row.foreign_net),
        institutionNet: row.institution_net === null ? null : Number(row.institution_net),
        individualNet: row.individual_net === null ? null : Number(row.individual_net),
      };
    })
    .reverse();
}
