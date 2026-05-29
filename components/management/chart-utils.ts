/**
 * 경영관리 누적막대 차트 공용 유틸.
 *
 * 범례 토글(hidden Set)에 따라 "보이는 시리즈만"의 합계를 계산하고,
 * 그 합계를 스택 최상단에 항상 고정 표시하기 위한 앵커 값을 제공한다.
 *
 * 합계 데이터 레이블을 스택 마지막 막대(<Bar>)의 자식 LabelList로 두면
 * (1) 정적 total을 그려 토글이 반영되지 않고 (2) 그 막대를 끄면 레이블도 사라진다.
 * 대신 무한소 값의 투명 앵커 막대를 스택 최상단에 두고 동적 합계를 그리면 두 문제 모두 해소된다.
 */

/**
 * 누적막대에서 범례로 숨기지 않은(보이는) 시리즈 값들의 합.
 * - null/undefined/NaN 값은 0으로 무시.
 * - 보이는 시리즈에 숫자가 하나도 없으면 null(=데이터 없음 → 레이블 미표시).
 */
export function sumVisibleStack<T>(
  point: T,
  keys: ReadonlyArray<keyof T>,
  hidden: ReadonlySet<string>
): number | null {
  let sum = 0;
  let hasValue = false;
  for (const key of keys) {
    if (hidden.has(String(key))) continue;
    const v = point[key];
    if (typeof v === 'number' && !Number.isNaN(v)) {
      sum += v;
      hasValue = true;
    }
  }
  return hasValue ? sum : null;
}

/**
 * 합계 레이블 앵커 막대의 무한소 값.
 * 0이면 recharts가 스택 세그먼트를 건너뛰어 LabelList 위치를 못 잡으므로,
 * 무한소로 채워 스택 최상단에 0-height 세그먼트가 항상 존재하게 한다.
 */
export const TOTAL_LABEL_ANCHOR = 0.0001;
