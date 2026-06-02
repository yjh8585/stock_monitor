/**
 * 차트 공용 스타일 토큰 (recharts).
 *
 * 기존에 40+개 차트 파일에 그대로 복붙되던 `<Tooltip>` 스타일 리터럴을 단일화한다.
 * 디자인 변경 시 이 파일만 고치면 전체 차트에 반영된다. (docs/chart-guide.md §6 제안 1)
 *
 * - TOOLTIP_CONTENT_STYLE    : 표준(16px). 대부분의 차트.
 * - TOOLTIP_CONTENT_STYLE_SM : 밀집 차트(OEM 회사별 등) 14px 변형.
 *
 * 사용: `<Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />`
 */
export const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  fontSize: '16px',
} as const;

export const TOOLTIP_CONTENT_STYLE_SM = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  fontSize: '14px',
} as const;
