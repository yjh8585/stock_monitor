/**
 * 휴머노이드(/humanoid) 도메인 데이터 입구 — fetch + 'use cache' + mapping.
 *
 * parts-top100 과 view 이름만 다르고, mapping 은 mapHumanoidStockRow(내부에서
 * mapDomesticStockRow 재사용)를 쓴다.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { type ExchangeRates, type HumanoidStockRow, mapHumanoidStockRow } from '@/lib/types';

/** `humanoid_stocks_view` + 환율 fetch — Cache Components 적용 (cacheLife='hours'). */
export async function getHumanoidData(): Promise<{
  rows: HumanoidStockRow[];
  rates: ExchangeRates;
}> {
  'use cache';
  cacheLife('hours');
  cacheTag('humanoid_stocks_view');
  // 🔴 exchange_rates_live 태그를 붙이지 말 것.
  // 이유·트레이드오프 → lib/related-stocks/source.ts, docs/isr-write-optimization.md

  const supabase = createSupabaseAnonClient();
  const [{ data: viewData, error: viewErr }, { data: fxData, error: fxErr }] = await Promise.all([
    supabase
      .from('humanoid_stocks_view')
      .select('*')
      .order('sales_rank', { ascending: true, nullsFirst: false }),
    supabase.from('exchange_rates_live').select('base,rate').in('base', ['USD', 'EUR', 'CNY']),
  ]);

  if (viewErr) {
    logger.error({ err: viewErr }, 'humanoid_stocks_view 조회 실패');
    throw new Error(`Supabase humanoid_stocks_view 조회 실패: ${viewErr.message}`);
  }
  if (fxErr) logger.error({ err: fxErr }, 'exchange_rates_live 조회 실패');

  const rows = (viewData ?? []).map(mapHumanoidStockRow);
  const rates: ExchangeRates = { USD: null, EUR: null, CNY: null };
  for (const r of fxData ?? []) {
    const base = r.base as keyof ExchangeRates;
    if (base in rates) rates[base] = Number(r.rate);
  }
  return { rows, rates };
}
