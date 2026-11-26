/**
 * 휴머노이드 「모터」 탭(/humanoid/motor) 데이터 입구 — fetch + 'use cache' + mapping.
 *
 * lib/humanoid/source.ts 와 view 이름·매퍼만 다르다.
 * 설계 = docs/superpowers/specs/2026-11-26-motor-tab-design.md
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { type ExchangeRates, type MotorStockRow, mapMotorStockRow } from '@/lib/types';

/** `motor_stocks_view` + 환율 fetch — Cache Components 적용 (cacheLife='hours'). */
export async function getMotorData(): Promise<{
  rows: MotorStockRow[];
  rates: ExchangeRates;
}> {
  'use cache';
  cacheLife('hours');
  cacheTag('motor_stocks_view');
  // 🔴 exchange_rates_live 태그를 붙이지 말 것.
  // 이유·트레이드오프 → lib/related-stocks/source.ts, docs/isr-write-optimization.md

  const supabase = createSupabaseAnonClient();
  const [{ data: viewData, error: viewErr }, { data: fxData, error: fxErr }] = await Promise.all([
    supabase
      .from('motor_stocks_view')
      .select('*')
      .order('sales_rank', { ascending: true, nullsFirst: false }),
    supabase.from('exchange_rates_live').select('base,rate').in('base', ['USD', 'EUR', 'CNY']),
  ]);

  if (viewErr) {
    logger.error({ err: viewErr }, 'motor_stocks_view 조회 실패');
    throw new Error(`Supabase motor_stocks_view 조회 실패: ${viewErr.message}`);
  }
  if (fxErr) logger.error({ err: fxErr }, 'exchange_rates_live 조회 실패');

  const rows = (viewData ?? []).map(mapMotorStockRow);
  const rates: ExchangeRates = { USD: null, EUR: null, CNY: null };
  for (const r of fxData ?? []) {
    const base = r.base as keyof ExchangeRates;
    if (base in rates) rates[base] = Number(r.rate);
  }
  return { rows, rates };
}
