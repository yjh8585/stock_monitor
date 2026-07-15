/**
 * 스텔란티스 탭(`/management/stellantis`) 공용 숫자 포맷.
 *
 * 카드 4장 + 차트 4종이 같은 표기 규칙을 쓰도록 한곳에 모은다.
 * (경영관리 다른 탭은 차트마다 지역 `fmt`를 두지만, 이 탭은 한 폴더 안에서 8개 파일이
 *  같은 규칙을 공유하므로 복붙 대신 모듈로 뺀다.)
 */

/** 천단위 콤마. null·NaN은 '—'. `digits` = 소수 자릿수. */
export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

/**
 * 부호를 항상 붙인 천단위 콤마(+1,234 / −1,234).
 * 갭·재고 증감처럼 **방향 자체가 의미**인 값에 쓴다 — 양수에 '+'가 없으면 축적/소진이 안 읽힌다.
 */
export function fmtSigned(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${fmt(n, digits)}`;
}

/** 비율(0.1234) → 퍼센트 문자열('12.3%'). 변동계수(CV) 표기용. */
export function fmtRatioPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}
