/**
 * 차트 청크(recharts) 로딩 중 자리표시자.
 *
 * `dynamic(..., { loading })`에 넘겨 레이아웃 점프(CLS)를 막는다.
 * 브레이크포인트는 `useChartHeight`(640 / 1024px 분기)와 정확히 맞춘다 — Tailwind `sm:`=640,
 * `lg:`=1024라 그대로 대응된다. (`md:`=768은 어긋나므로 쓰지 않는다.)
 */

/** 3-tier 높이 — chart-guide §5-F. `md`=중형(280/360/440), `lg`=대형(360/440/520). */
const HEIGHT_CLASS = {
  md: 'h-[280px] sm:h-[360px] lg:h-[440px]',
  lg: 'h-[360px] sm:h-[440px] lg:h-[520px]',
} as const;

export function ChartFallback({ size = 'lg' }: { size?: keyof typeof HEIGHT_CLASS }) {
  return <div className={`${HEIGHT_CLASS[size]} animate-pulse rounded bg-muted/20`} />;
}
