/**
 * 국내자동차(/domestic) 도메인 데이터 입구 — fetch + 'use cache' + mapping.
 *
 * 페이지는 본 모듈의 함수만 호출하면 된다. anon Supabase 클라이언트 선택,
 * view fetch + 환율 fetch, cache 메타데이터, Row → DTO mapping은 모두
 * 이 안에 격리되어 있다.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { type DomesticStockRow, type ExchangeRates, mapDomesticStockRow } from '@/lib/types';

/** `domestic_stocks_view` + 환율 fetch — Cache Components 적용 (cacheLife='hours'). */
export async function getDomesticData(): Promise<{
  rows: DomesticStockRow[];
  rates: ExchangeRates;
}> {
  'use cache';
  cacheLife('hours');
  cacheTag('domestic_stocks_view');
  // 🔴 exchange_rates_live 태그를 붙이지 말 것 — 이 라우트가 3개 중 가장 무거워
  // (1,089KB) FX 수집마다 재기록하면 ISR write 를 가장 크게 먹는다.
  // 상세 이유·트레이드오프 → lib/related-stocks/source.ts, docs/isr-write-optimization.md

  const supabase = createSupabaseAnonClient();
  const [{ data: viewData, error: viewErr }, { data: fxData, error: fxErr }] = await Promise.all([
    supabase
      .from('domestic_stocks_view')
      .select('*')
      .order('sales_rank', { ascending: true, nullsFirst: false }),
    supabase.from('exchange_rates_live').select('base,rate').in('base', ['USD', 'EUR', 'CNY']),
  ]);

  if (viewErr) {
    logger.error({ err: viewErr }, 'domestic_stocks_view 조회 실패');
    throw new Error(`Supabase domestic_stocks_view 조회 실패: ${viewErr.message}`);
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
