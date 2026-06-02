/**
 * OEM 차트 공통 스타일 상수 + 유틸.
 *
 * - GRID_STROKE_OPACITY: CartesianGrid 보조선 흐리게 (다크모드 호환, hsl(var(--border))에 적용).
 * - DATA_LABEL_STYLE: 막대 위 데이터 라벨 (LabelList) 15px bold, foreground 색.
 *   2026-05-27 — 사용자 가독성 요청으로 13px → 15px 상향.
 * - Y_AXIS_PADDED_DOMAIN: 막대 위 데이터 라벨이 잘리지 않도록 Y축 최대값을 1.1배 자동 확장.
 *   recharts `<YAxis domain={Y_AXIS_PADDED_DOMAIN} />` 형태로 사용.
 *
 * 사용 예:
 *   <CartesianGrid strokeDasharray="3 3" className="stroke-border" strokeOpacity={GRID_STROKE_OPACITY} vertical={mode === 'month'} />
 *   <YAxis domain={Y_AXIS_PADDED_DOMAIN} />
 *   <LabelList dataKey="value" position="top" formatter={fmt} style={DATA_LABEL_STYLE} />
 */
export const GRID_STROKE_OPACITY = 0.3;

export const DATA_LABEL_STYLE = {
  fill: 'var(--foreground)',
  fontSize: 15,
  fontWeight: 700,
} as const;

/**
 * Y축 domain — dataMax × 1.1 자동 padding.
 * 막대 위 LabelList(position='top') 라벨이 차트 밖으로 벗어나지 않도록 보장.
 * recharts: `domain={[0, (dataMax) => Math.ceil(dataMax * 1.1)]}` 와 동치.
 */
export const Y_AXIS_PADDED_DOMAIN: [number, (dataMax: number) => number] = [
  0,
  (dataMax: number) => Math.ceil(dataMax * 1.1),
];

/**
 * 누적막대 합계 데이터 레이블을 범례 토글에 연동시키는 유틸.
 *
 * 합계 레이블을 스택 마지막 막대의 LabelList로 두면 (1) 정적 total을 그려 토글이 반영 안 되고
 * (2) 그 막대를 끄면 레이블도 사라진다. 대신 무한소 값의 투명 앵커 막대를 스택 최상단에 두고
 * sumVisibleStack 으로 "보이는 시리즈만"의 합을 동적으로 그려 두 문제를 모두 해소한다.
 * (경영관리 차트 components/management/chart-utils.ts 와 동일 패턴.)
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

/** 보이는(숨기지 않은) 시리즈 키들의 값 합. YoY 등 토글 연동 계산용(빈 객체면 0). */
export function sumVisible(
  obj: Record<string, unknown> | undefined,
  keys: readonly string[],
  hidden: ReadonlySet<string>
): number {
  if (!obj) return 0;
  let s = 0;
  for (const key of keys) {
    if (hidden.has(key)) continue;
    const v = obj[key];
    if (typeof v === 'number' && !Number.isNaN(v)) s += v;
  }
  return s;
}
