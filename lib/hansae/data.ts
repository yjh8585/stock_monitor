/**
 * 한세 대시보드(/app/hansae) 서버 데이터 로더.
 * 모두 service_role을 쓰지 않고 anon으로 충분(읽기 전용 + RLS anon read 허용).
 */
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';

// 표시 순서 고정: 한세예스24홀딩스, 한세실업, 한세엠케이, 예스24
export const HANSAE_TICKERS = ['016450', '105630', '069640', '053280'] as const;
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

export interface DailyPrice {
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  changePct: number | null;
}

export interface IntradaySupplyPoint {
  snapshotTs: string;
  foreignNet: number | null;
  institutionNet: number | null;
  individualNet: number | null;
}

export interface SupplyDemandRow {
  tradeDate: string;
  foreignNet: number | null;
  institutionNet: number | null;
  individualNet: number | null;
  closePrice: number | null;
  changePct: number | null;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string | null;
  source: string | null;
  summary: string | null;
  publishedAt: string;
}

/** 종목별 오늘(KST 00:00 이후) 발행 뉴스 — 코멘트 컨텍스트용 */
export async function getTodayNews(companyId: string, limit = 10): Promise<NewsItem[]> {
  const sb = createSupabaseAnonClient();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data, error } = await sb
    .from('news')
    .select('id,title,url,source,summary,published_at')
    .eq('company_id', companyId)
    .gte('published_at', start.toISOString())
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) {
    logger.error({ err: error, companyId }, '오늘 뉴스 조회 실패');
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      title: (row.title as string) ?? '',
      url: row.url as string | null,
      source: row.source as string | null,
      summary: row.summary as string | null,
      publishedAt: row.published_at as string,
    };
  });
}

export async function getHansaeCompanies(): Promise<HansaeCompany[]> {
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('companies')
    .select('id,ticker,name_kr,market,last_price,last_change_pct,last_volume,last_updated_at')
    .in('ticker', HANSAE_TICKERS as unknown as string[]);
  if (error) {
    logger.error({ err: error }, '한세 companies 조회 실패');
    return [];
  }
  const byTicker = new Map<string, HansaeCompany>();
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    byTicker.set(row.ticker as string, {
      id: row.id as string,
      ticker: row.ticker as string,
      name_kr: (row.name_kr as string) ?? '',
      market: row.market as string | null,
      lastPrice: row.last_price as number | null,
      lastChangePct: row.last_change_pct as number | null,
      lastVolume: row.last_volume as number | null,
      lastUpdatedAt: row.last_updated_at as string | null,
    });
  }
  // HANSAE_TICKERS 배열 순서를 그대로 유지(한세예스24홀딩스→한세실업→한세엠케이→예스24)
  return HANSAE_TICKERS.map((t) => byTicker.get(t)).filter(
    (c): c is HansaeCompany => c !== undefined
  );
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

/** 종목별 최근 N년치 일별 OHLCV.
 *  stock_prices 테이블(메인 collect-prices.yml이 매일 적재)을 사용.
 *  change_pct 컬럼이 없으므로 정렬 후 prev close로 클라이언트에서 계산. */
export async function getDailyPrices(companyId: string, years = 5): Promise<DailyPrice[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseAnonClient() as any;
  const since = new Date();
  since.setFullYear(since.getFullYear() - years);
  const sinceStr = since.toISOString().slice(0, 10);
  // Supabase PostgREST db-max-rows=1000이라 5년치(~1250행) 한 번에 못 가져옴.
  // range 페이지네이션으로 1000행씩 누적.
  const PAGE = 1000;
  const all: unknown[] = [];
  for (let from = 0; from < years * 260 + 100; from += PAGE) {
    const { data, error } = await sb
      .from('stock_prices')
      .select('trade_date,open,high,low,close,volume')
      .eq('company_id', companyId)
      .gte('trade_date', sinceStr)
      .order('trade_date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      logger.error({ err: error, companyId }, '일봉 조회 실패');
      return [];
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  let prevClose: number | null = null;
  return all.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const close = row.close == null ? null : Number(row.close);
    const changePct =
      close == null || prevClose == null || prevClose === 0
        ? null
        : ((close - prevClose) / prevClose) * 100;
    prevClose = close;
    return {
      tradeDate: row.trade_date as string,
      open: row.open == null ? null : Number(row.open),
      high: row.high == null ? null : Number(row.high),
      low: row.low == null ? null : Number(row.low),
      close,
      volume: row.volume == null ? null : Number(row.volume),
      changePct,
    };
  });
}

/** 종목별 오늘(KST) 분 단위 잠정 수급 스냅샷. 장중 cron이 5분마다 INSERT. */
export async function getIntradaySupply(companyId: string): Promise<IntradaySupplyPoint[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createSupabaseAnonClient() as any;
  // KST today (YYYY-MM-DD) — UTC slice은 timezone에 따라 빗나가므로 명시.
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const { data, error } = await sb
    .from('stock_supply_demand_intraday')
    .select('snapshot_ts,foreign_net,institution_net,individual_net')
    .eq('company_id', companyId)
    .eq('trade_date', today)
    .order('snapshot_ts', { ascending: true });
  if (error) {
    logger.error({ err: error, companyId }, '분 단위 수급 조회 실패');
    return [];
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    snapshotTs: r.snapshot_ts as string,
    foreignNet: r.foreign_net == null ? null : Number(r.foreign_net),
    institutionNet: r.institution_net == null ? null : Number(r.institution_net),
    individualNet: r.individual_net == null ? null : Number(r.individual_net),
  }));
}

/** 종목별 최근 N거래일 수급 */
export async function getRecentSupplyDemand(
  companyId: string,
  days = 5
): Promise<SupplyDemandRow[]> {
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('stock_supply_demand')
    .select('trade_date,foreign_net,institution_net,individual_net,close_price,change_pct')
    .eq('company_id', companyId)
    .order('trade_date', { ascending: false })
    .limit(days);
  if (error) {
    logger.error({ err: error, companyId }, '수급 조회 실패');
    return [];
  }
  return (data ?? [])
    .map((r) => {
      const row = r as unknown as Record<string, unknown>;
      return {
        tradeDate: row.trade_date as string,
        foreignNet: row.foreign_net === null ? null : Number(row.foreign_net),
        institutionNet: row.institution_net === null ? null : Number(row.institution_net),
        individualNet: row.individual_net === null ? null : Number(row.individual_net),
        closePrice: row.close_price == null ? null : Number(row.close_price),
        changePct: row.change_pct == null ? null : Number(row.change_pct),
      };
    })
    .reverse();
}
