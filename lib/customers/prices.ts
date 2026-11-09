import type { PricePoint, PriceReturns } from './types';

/** 'YYYY-MM-DD' 에서 한 달 뺀 날짜(말일은 그 달 말일로). UTC 로 만들고 UTC 로 읽는다 — 시간대 섞임 없음. */
function minusOneMonth(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

const pct = (now: number, base: number | undefined) =>
  base == null || base <= 0 ? null : ((now - base) / base) * 100;

/** 일봉 → 마지막 종가·1M·YTD. 기준일은 데이터의 마지막 거래일(오늘 시각을 쓰지 않는다). */
export function priceReturns(series: PricePoint[]): PriceReturns {
  if (series.length === 0)
    return { lastClose: null, lastDate: null, return1mPct: null, returnYtdPct: null };
  const s = [...series].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const last = s[s.length - 1];
  const earlier = s.slice(0, -1).reverse();
  const closeOnOrBefore = (cut: string) => earlier.find((p) => p.trade_date <= cut)?.close;
  return {
    lastClose: last.close,
    lastDate: last.trade_date,
    return1mPct: pct(last.close, closeOnOrBefore(minusOneMonth(last.trade_date))),
    returnYtdPct: pct(
      last.close,
      closeOnOrBefore(`${Number(last.trade_date.slice(0, 4)) - 1}-12-31`)
    ),
  };
}
