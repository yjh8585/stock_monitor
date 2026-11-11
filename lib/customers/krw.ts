/**
 * 고객사 요약 표의 원화 환산 — 그 분기 일별 환율(`exchange_rates`, 1 통화 = N 원)의 평균으로 바꾼다(결정 R5 · 2026-11-11).
 * 고객사가 전부 12월 결산이라 회계 분기 = 달력 분기로 본다(2026-11-11 DB 실측).
 * SHORTCUT: 12월 결산이 아닌 고객사가 들어오면 분기 범위가 어긋난다 → companies.fiscal_year_end_month 로 범위를 밀 것.
 */

export interface RateRow {
  rate_date: string; // YYYY-MM-DD
  rate: number;
}

/** 달력 분기의 첫날·마지막날(YYYY-MM-DD, 문자열 비교용). */
export function quarterRange(year: number, quarter: number): { start: string; end: string } {
  const m1 = (quarter - 1) * 3 + 1;
  const m3 = m1 + 2;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${year}-${pad(m1)}-01`, end: `${year}-${pad(m3)}-31` };
}

/** 그 분기 일별 환율 평균. 그 분기 행이 없으면 null(환산 생략). */
export function quarterAvgRate(
  rows: readonly RateRow[],
  year: number,
  quarter: number
): number | null {
  const { start, end } = quarterRange(year, quarter);
  const inQ = rows.filter((r) => r.rate_date >= start && r.rate_date <= end);
  if (inQ.length === 0) return null;
  return inQ.reduce((s, r) => s + r.rate, 0) / inQ.length;
}

/**
 * 현지 통화 십억(bn) 매출 → 원. KRW 면 환율 없이 그대로.
 * 환율이 없거나 매출이 없으면 null.
 */
export function revenueKrw(
  revenueBn: number | null,
  currency: string | null,
  rates: readonly RateRow[],
  year: number,
  quarter: number
): number | null {
  if (revenueBn == null || currency == null) return null;
  if (currency === 'KRW') return revenueBn * 1e9;
  const rate = quarterAvgRate(rates, year, quarter);
  return rate == null ? null : revenueBn * 1e9 * rate;
}

/** 원 금액 표기 — 1조 이상은 「12.3조원」, 미만은 「4,560억원」. */
export function krwText(won: number | null): string {
  if (won == null || !Number.isFinite(won)) return '—';
  const JO = 1e12;
  if (Math.abs(won) >= JO) return `${(won / JO).toFixed(1)}조원`;
  return `${Math.round(won / 1e8).toLocaleString('ko-KR')}억원`;
}
