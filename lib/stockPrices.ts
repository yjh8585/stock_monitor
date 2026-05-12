/**
 * 주가 페이지(/etc/stock-prices) 데이터 액세스.
 * companies(active) + stock_prices 5년치를 anon Supabase로 조회한다.
 * 모든 함수는 'use cache' + cacheLife('hours') + cacheTag.
 */
import { cacheLife, cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';
import type { SeriesPoint } from '@/lib/series';
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

/** 단일 종목 5년치 일봉 시계열 (close 기준) */
export async function getStockPriceSeries(companyId: string): Promise<SeriesPoint[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('stock_prices');
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
  return rows.map((r) => ({ time: r.trade_date, value: Number(r.close) }));
}
