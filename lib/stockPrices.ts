/**
 * 주가 페이지(/etc/stock-prices) 데이터 액세스.
 * companies(active) + stock_prices 5년치를 anon Supabase로 조회한다.
 * 모든 함수는 'use cache' + cacheLife('hours') + cacheTag.
 */
import { cacheLife, cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';
import { appendLivePoint, type SeriesPoint } from '@/lib/series';
import type { StockCompany } from '@/lib/types';

// PostgREST 1000행 cap 우회 — stock_prices는 1종목 5년치 ~1300행이라 2페이지면 충분.
const PAGE_SIZE = 1000;
const MAX_PAGES = 4;

/** active + 상장(market NOT NULL) 회사 목록 — 비상장사는 주가 페이지 노출 대상 아님 */
export async function getActiveStockCompanies(): Promise<StockCompany[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('companies');
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('companies')
    .select('id,ticker,name,name_kr,country')
    .eq('status', 'active')
    .not('market', 'is', null)
    .order('name_kr', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'companies 조회 실패');
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    ticker: r.ticker,
    name: r.name,
    name_kr: r.name_kr ?? r.name,
    country: r.country ?? '',
  }));
}

/**
 * 단일 종목 5년치 일봉 시계열 (close 기준).
 *
 * 오늘 일봉은 stock_prices 에 장 마감 후에야 들어오므로, 장중에는 stock_quotes_5min
 * 의 가장 최근 가격을 "오늘 일자" 점으로 합성해 차트가 멈춰 보이는 현상을 막는다.
 * stock_prices·stock_quotes_5min 태그를 cron이 무효화하므로 신선도는 무효화가 담당.
 * cacheLife는 백업 만료용이라 hours면 충분 (minutes는 종목별 캐시라 ISR write 폭증).
 */
export async function getStockPriceSeries(companyId: string): Promise<SeriesPoint[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('stock_prices');
  cacheTag('stock_quotes_5min');
  cacheTag('companies');
  const sb = createSupabaseAnonClient();

  const rows: { trade_date: string; close: number }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from('stock_prices')
      .select('trade_date,close')
      .eq('company_id', companyId)
      .order('trade_date', { ascending: true })
      .range(from, to);
    if (error) {
      logger.error({ err: error, companyId, page }, 'stock_prices 조회 실패');
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  const series: SeriesPoint[] = rows.map((r) => ({
    time: r.trade_date,
    value: Number(r.close),
  }));

  // 최신 5분봉 1건 — 오늘 일봉 점 합성용
  const { data: lastQuote } = await sb
    .from('stock_quotes_5min')
    .select('ts,price')
    .eq('company_id', companyId)
    .order('ts', { ascending: false })
    .limit(1);
  const last = lastQuote?.[0];
  if (last) {
    // ts(UTC) → KST 일자
    const kstDate = new Date(new Date(last.ts).getTime() + 9 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    const price = Number(last.price);
    const lastSeries = series[series.length - 1];
    if (lastSeries && lastSeries.time === kstDate) {
      lastSeries.value = price;
    } else if (!lastSeries || lastSeries.time < kstDate) {
      series.push({ time: kstDate, value: price });
    }
    return series;
  }

  // 5분봉이 없는 종목(한세 외) — companies.last_price를 fallback 끝점으로 합성.
  // collect_prices_live가 매시 갱신하는 KR·글로벌 종목이 대상.
  const { data: company } = await sb
    .from('companies')
    .select('last_price,last_updated_at')
    .eq('id', companyId)
    .maybeSingle();
  if (company?.last_price != null && company.last_updated_at) {
    return appendLivePoint(series, {
      value: Number(company.last_price),
      updated_at: company.last_updated_at as string,
    });
  }
  return series;
}
