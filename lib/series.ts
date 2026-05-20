/**
 * 기타 섹션(환율·원자재·경제·운임) 시계열·메타 데이터 액세스.
 * 모든 함수는 'use cache' + cacheLife('hours') + cacheTag로 캐시된다.
 */
import { cacheLife, cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';

export type SeriesPoint = { time: string; value: number }; // time: 'YYYY-MM-DD'

// Supabase PostgREST anon role은 1000행 cap이 걸려 있어 .limit()로 우회되지 않는다.
// 5년 일봉(~1300행)을 모두 가져오려면 .range()로 페이지네이션해야 한다.
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

export type SeriesCategory = 'fx_extra' | 'commodity' | 'economy' | 'shipping';

export type SeriesMeta = {
  series_code: string;
  label: string;
  unit: string;
  source: string;
  category: SeriesCategory;
  hasData: boolean; // yf_symbol 또는 fred_symbol이 지정되어 수집 대상인 경우
};

export type MacroNote = {
  id: string;
  note_date: string;
  source: string;
  summary: string;
  sentiment: string | null;
};

/** USD/EUR/CNY → KRW 환율 5년 일봉을 SeriesPoint[]로 반환 (exchange_rates 재사용) */
export async function getExchangeRateSeries(base: 'USD' | 'EUR' | 'CNY'): Promise<SeriesPoint[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('exchange_rates');
  const sb = createSupabaseAnonClient();

  const rows: { rate_date: string; rate: number }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from('exchange_rates')
      .select('rate_date,rate')
      .eq('base', base)
      .eq('quote', 'KRW')
      .order('rate_date', { ascending: true })
      .range(from, to);
    if (error) {
      logger.error({ err: error, base, page }, 'exchange_rates 조회 실패');
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows.map((r) => ({ time: r.rate_date, value: Number(r.rate) }));
}

/**
 * 라이브 환율 조회 (USD/EUR/CNY → KRW).
 *
 * `exchange_rates_live`는 평일 매시 정각(UTC) cron이 yfinance fast_info로 갱신한다.
 * 일봉(`exchange_rates`)은 종가 기반이라 당일 데이터가 늦게 들어오므로,
 * 차트 끝점만 라이브 값으로 갈아치우기 위한 보조 데이터.
 *
 * cache는 minutes 단위로 짧게 — cron이 매시간이라 5~10분 캐시면 충분.
 */
export async function getLiveExchangeRate(
  base: 'USD' | 'EUR' | 'CNY'
): Promise<{ rate: number; updated_at: string } | null> {
  'use cache';
  cacheLife('minutes');
  cacheTag('exchange_rates_live');
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('exchange_rates_live')
    .select('rate,updated_at')
    .eq('base', base)
    .eq('quote', 'KRW')
    .maybeSingle();
  if (error) {
    logger.error({ err: error, base }, 'exchange_rates_live 조회 실패');
    return null;
  }
  if (!data) return null;
  return { rate: Number(data.rate), updated_at: data.updated_at as string };
}

/**
 * 일봉 시리즈 끝에 라이브 가격 점을 합쳐 반환.
 *
 * - live KST 일자 > 일봉 마지막 일자 → 새 점 추가 ("오늘" 끝점)
 * - live KST 일자 == 일봉 마지막 일자 → 마지막 점 값을 live로 덮어쓰기
 * - live가 더 오래되거나 없으면 일봉 그대로
 *
 * 과거 일자는 손대지 않음 — 종가가 그대로 유지된다.
 */
export function appendLivePoint(
  series: SeriesPoint[],
  live: { rate: number; updated_at: string } | null
): SeriesPoint[] {
  if (!live) return series;
  // updated_at(UTC) → KST(=+9) 기준 'YYYY-MM-DD' 추출
  const utcMs = new Date(live.updated_at).getTime();
  if (!Number.isFinite(utcMs)) return series;
  const kstDate = new Date(utcMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const last = series.at(-1);
  if (!last) return [{ time: kstDate, value: live.rate }];
  if (kstDate < last.time) return series;
  if (kstDate === last.time) {
    return [...series.slice(0, -1), { time: kstDate, value: live.rate }];
  }
  return [...series, { time: kstDate, value: live.rate }];
}

/** market_series_daily에서 특정 series_code의 일봉 시계열 조회 */
export async function getMarketSeries(seriesCode: string): Promise<SeriesPoint[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('market_series_daily');
  const sb = createSupabaseAnonClient();

  const rows: { trade_date: string; close: number }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from('market_series_daily')
      .select('trade_date,close')
      .eq('series_code', seriesCode)
      .order('trade_date', { ascending: true })
      .range(from, to);
    if (error) {
      logger.error({ err: error, seriesCode, page }, 'market_series_daily 조회 실패');
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows.map((r) => ({ time: r.trade_date, value: Number(r.close) }));
}

/** 카테고리별 market_series 메타데이터 조회 (sort_order 오름차순) */
export async function getSeriesMetaByCategory(category: SeriesCategory): Promise<SeriesMeta[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('market_series');
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('market_series')
    .select('series_code,label,unit,source,category,yf_symbol,fred_symbol,sort_order')
    .eq('category', category)
    .order('sort_order', { ascending: true });

  if (error) {
    logger.error({ err: error, category }, 'market_series 조회 실패');
    return [];
  }
  return (data ?? []).map((r) => ({
    series_code: r.series_code,
    label: r.label,
    unit: r.unit,
    source: r.source,
    category: r.category as SeriesCategory,
    // 수집 가능 판정: yfinance/FRED 직접 수집 또는 별도 스크래퍼(source != 'placeholder')로 1회 이상 적재됨
    hasData: r.yf_symbol != null || r.fred_symbol != null || r.source !== 'placeholder',
  }));
}

/** 미국 경제 통합 요약 (source='US_ECONOMY')에서 가장 최근 1건 */
export async function getEconomyOutlook(): Promise<MacroNote | null> {
  'use cache';
  cacheLife('hours');
  cacheTag('macro_outlook_notes');
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('macro_outlook_notes')
    .select('id,note_date,source,summary,sentiment')
    .eq('source', 'US_ECONOMY')
    .order('note_date', { ascending: false })
    .limit(1);

  if (error) {
    logger.error({ err: error }, 'macro_outlook_notes 조회 실패');
    return null;
  }
  const r = (data ?? [])[0];
  if (!r) return null;
  return {
    id: r.id,
    note_date: r.note_date,
    source: r.source,
    summary: r.summary,
    sentiment: r.sentiment ?? null,
  };
}
