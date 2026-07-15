import { MGMT_BAR_COLORS } from '@/components/charts/palette';
import type { ForecastScenario } from '@/lib/stellantis-forecast/types';

/**
 * 전망 시나리오의 색·패턴 id — 차트(막대)와 래퍼(가정 목록 색 칩)가 **같은 규칙**을 쓰도록 분리.
 *
 * 차트 Inner는 `dynamic(ssr:false)`로 lazy 로딩되므로 래퍼가 Inner에서 색을 import하면
 * recharts 청크가 래퍼로 끌려와 코드 스플릿이 무의미해진다. 그래서 색 규칙만 여기 둔다.
 * (양쪽에 리터럴을 복붙하면 범례·막대 색이 조용히 어긋난다 — chart-guide §7-7이 경고하는 버그.)
 */

/** 실적 막대 색 — 경영관리 막대 첫 번째 색. */
export const ACTUAL_COLOR = MGMT_BAR_COLORS[0];

/** 시나리오 막대 색 — 실적([0]) 다음 순서로 `MGMT_BAR_COLORS`를 이어 쓴다(chart-guide §5-A). */
export function scenarioColor(index: number): string {
  return MGMT_BAR_COLORS[index + 1];
}

/** 시나리오별 빗금 패턴 id (문서 전역 유일해야 함). */
export function scenarioHatchId(key: ForecastScenario['key']): string {
  return `stellantis-forecast-${key}`;
}
