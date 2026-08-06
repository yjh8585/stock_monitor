/**
 * 관련회사(/related-stocks) 도메인 데이터 입구 — fetch + 'use cache' + mapping.
 *
 * 페이지는 본 모듈의 함수만 호출하면 된다. anon Supabase 클라이언트 선택,
 * view fetch + 환율 fetch, cache 메타데이터(tag/life), Row → DTO mapping은
 * 모두 이 안에 격리되어 있다.
 *
 * lib/pnl/source.ts와 같은 패턴. AGENTS.md 도메인 폴더 섹션 참고.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { type ExchangeRates, mapRelatedStockRow, type RelatedStockRow } from '@/lib/types';

/**
 * `related_stocks_view` + 환율 fetch — Cache Components 적용 (cacheLife='hours').
 *
 * 캐시 무효화: collect_prices_live / collect_fx 등이 `related_stocks_view`·
 * `exchange_rates_live` 태그 갱신 시 자동 stale.
 */
export async function getRelatedStocksData(): Promise<{
  rows: RelatedStockRow[];
  rates: ExchangeRates;
}> {
  'use cache';
  cacheLife('hours');
  cacheTag('related_stocks_view');
  // 🔴 exchange_rates_live 태그를 붙이지 말 것 — FX 수집(하루 ~5회)마다 이 무거운
  // 라우트가 통째로 재기록된다(ISR write 는 payload 크기 기준 과금). 환율맵은 아래에서
  // 계속 읽지만 무효화 대상에서만 뺀다 → 환산값은 주가·재무 무효화나 cacheLife 만료로
  // 최대 1시간 내 따라오고, 사용자가 보는 주가·등락률은 위 뷰 태그로 즉시 갱신된다.
  // 함수 분리로는 해결되지 않는다(라우트가 여전히 await → 재기록). docs/isr-write-optimization.md

  const supabase = createSupabaseAnonClient();
  const [{ data: viewData, error: viewErr }, { data: fxData, error: fxErr }] = await Promise.all([
    supabase
      .from('related_stocks_view')
      .select('*')
      .order('company_type', { ascending: false })
      .order('name_kr', { ascending: true }),
    supabase.from('exchange_rates_live').select('base,rate').in('base', ['USD', 'EUR', 'CNY']),
  ]);

  if (viewErr) {
    logger.error({ err: viewErr }, 'related_stocks_view 조회 실패');
    throw new Error(`Supabase related_stocks_view 조회 실패: ${viewErr.message}`);
  }
  if (fxErr) logger.error({ err: fxErr }, 'exchange_rates_live 조회 실패');

  const rows = (viewData ?? []).map(mapRelatedStockRow);
  const rates: ExchangeRates = { USD: null, EUR: null, CNY: null };
  for (const r of fxData ?? []) {
    const base = r.base as keyof ExchangeRates;
    if (base in rates) rates[base] = Number(r.rate);
  }
  return { rows, rates };
}
