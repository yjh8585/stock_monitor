/**
 * 실적 콤보 차트의 매출(십억 단위 입력) 표기 — 통화별.
 * KRW 는 현대 IR 차트의 기존 표기(조원)를 그대로 옮긴 것이다(기본값 = 변경 전 동작).
 */
export interface RevenueFormat {
  axisLabel: string;
  tick: (n: number) => string;
  label: (value: unknown) => string;
  tooltip: (v: number) => string;
}

/** 막대 위 데이터 라벨 공통 — NULL·0·비수치는 빈 문자열. */
function labelOf(value: unknown, f: (n: number) => string): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return f(n);
}

export function revenueFormat(currency: string): RevenueFormat {
  if (currency === 'KRW') {
    return {
      axisLabel: '매출(조원)',
      tick: (n) => `${(n / 1000).toFixed(0)}조`,
      label: (value) => labelOf(value, (n) => `${(n / 1000).toFixed(1)}조`),
      tooltip: (v) => `${v.toLocaleString('ko-KR')} 십억원 (≈${(v / 1000).toFixed(1)}조원)`,
    };
  }
  return {
    axisLabel: `매출(${currency} bn)`,
    tick: (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 }),
    label: (value) =>
      labelOf(value, (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })),
    tooltip: (v) => `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} bn ${currency}`,
  };
}
