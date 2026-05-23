/**
 * 부품사 Top100(/parts-top100) 도메인 데이터 입구 — fetch + 'use cache' + mapping.
 *
 * domestic과 view 이름만 다르고 mapping은 mapDomesticStockRow 재사용.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { type DomesticStockRow, type ExchangeRates, mapDomesticStockRow } from '@/lib/types';

/** `parts_top100_stocks_view` + 환율 fetch — Cache Components 적용 (cacheLife='hours'). */
export async function getPartsTop100Data(): Promise<{
  rows: DomesticStockRow[];
  rates: ExchangeRates;
}> {
  'use cache';
  cacheLife('hours');
  cacheTag('parts_top100_stocks_view');
  cacheTag('exchange_rates_live');

  const supabase = createSupabaseAnonClient();
  const [{ data: viewData, error: viewErr }, { data: fxData, error: fxErr }] = await Promise.all([
    supabase
      .from('parts_top100_stocks_view')
      .select('*')
      .order('sales_rank', { ascending: true, nullsFirst: false }),
    supabase.from('exchange_rates_live').select('base,rate').in('base', ['USD', 'EUR', 'CNY']),
  ]);

  if (viewErr) {
    logger.error({ err: viewErr }, 'parts_top100_stocks_view 조회 실패');
    throw new Error(`Supabase parts_top100_stocks_view 조회 실패: ${viewErr.message}`);
  }
  if (fxErr) logger.error({ err: fxErr }, 'exchange_rates_live 조회 실패');

  const rows = (viewData ?? []).map(mapDomesticStockRow);
  const rates: ExchangeRates = { USD: null, EUR: null, CNY: null };
  for (const r of fxData ?? []) {
    const base = r.base as keyof ExchangeRates;
    if (base in rates) rates[base] = Number(r.rate);
  }
  return { rows, rates };
}
