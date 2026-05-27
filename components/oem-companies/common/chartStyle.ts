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
