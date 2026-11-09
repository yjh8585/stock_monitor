/** 고객사 화면 공용 표시 함수 — 요약 표('use client')와 개별 페이지(서버)가 함께 쓴다. */

/** 퍼센트 문자열 — 값이 없으면 「—」, signed 면 양수에 + 를 붙인다. */
export function pctText(v: number | null, signed = true): string {
  if (v == null) return '—';
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/** 증감 색 — 양수 초록·음수 빨강·0/없음 회색. */
export function pctClass(v: number | null): string {
  if (v == null || v === 0) return 'text-muted-foreground';
  return v > 0 ? 'text-emerald-600' : 'text-rose-600';
}
