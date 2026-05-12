import { ExchangeRates, FinancialYear } from './types';

/**
 * 백만 단위 원본 통화 → KRW 십억원 문자열
 * revenue(백만) × fx ÷ 1,000 = 십억원
 */
export function toB(millionOrig: number | null, fxToKrw: number | null): string {
  if (millionOrig == null || fxToKrw == null) return '—';
  const billions = (millionOrig * fxToKrw) / 1_000;
  return Math.round(billions).toLocaleString('ko-KR');
}

/**
 * 억원 단위 시가총액 → 조원 문자열 (소수점 1자리)
 * market_cap은 억원 단위, KRW 기준
 */
export function toT(eokWon: number | null): string {
  if (eokWon == null) return '—';
  return (eokWon / 10_000).toFixed(1);
}

/** 숫자 → 소수점 1자리 퍼센트 문자열 (단위 % 포함) */
export function fmtPct(n: number | null): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

/** 주가 → 천 단위 콤마 문자열 */
export function fmtPrice(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

/** 소수점 1자리 숫자 포매팅 */
export function fmtNum(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(1);
}

/**
 * 전년 대비 성장률 (%)
 * 분모가 0이거나 null이면 null 반환
 */
export function growthPct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/**
 * 복합 연평균 성장률 (CAGR)
 * years: 기간(연)
 */
export function calcCagr(start: number | null, end: number | null, years: number): number | null {
  if (start == null || end == null || start <= 0 || years <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

/** 재고회전율 = 매출 / 재고자산 */
export function invTurnover(fy: FinancialYear | undefined): number | null {
  if (!fy?.revenue || !fy?.inventory || fy.inventory === 0) return null;
  return fy.revenue / fy.inventory;
}

/** 양수=빨강, 음수=파랑, 0=회색 클래스 반환 */
export function arrowColor(n: number | null): string {
  if (n == null) return 'text-muted-foreground';
  if (n > 0) return 'text-red-500';
  if (n < 0) return 'text-blue-600';
  return 'text-muted-foreground';
}

/** ▲/▼ 화살표 + 등락률 문자열 */
export function fmtChange(n: number | null): string {
  if (n == null) return '';
  const arrow = n >= 0 ? '▲' : '▼';
  return `${arrow}${Math.abs(n).toFixed(1)}%`;
}

/**
 * 안전한 날짜 포매터 — null/invalid 시 빈 문자열 반환.
 * 외부 API/DB의 날짜 필드가 잘못된 값일 때 'Invalid Date' 노출 방지.
 */
export function safeDateLabel(s: string | null | undefined, locale = 'ko-KR'): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale);
}

/**
 * 환율 안내 문자열 — "1,234원/달러, 1,456원/유로, …"
 * 통화별 누락 시 해당 항목 생략. FilterBar 우측 슬롯 라벨용.
 */
export function formatRateLabel(rates: ExchangeRates): string {
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
  const parts: string[] = [];
  if (rates.USD != null) parts.push(`${fmt(rates.USD)}원/달러`);
  if (rates.EUR != null) parts.push(`${fmt(rates.EUR)}원/유로`);
  if (rates.CNY != null) parts.push(`${fmt(rates.CNY)}원/위안`);
  return parts.join(', ');
}
