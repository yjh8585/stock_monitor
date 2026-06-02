/**
 * 경영관리 누적막대 차트 공용 유틸.
 *
 * (2026-06-02 중복 제거) 동일 구현이 chartStyle.ts에도 있어 단일화했다.
 * SSOT는 `components/oem-companies/common/chartStyle.ts`이며, 여기서는 기존 import 경로
 * 호환을 위해 re-export만 유지한다. (docs/chart-guide.md §6 제안 2)
 *
 * - sumVisibleStack: 범례로 숨기지 않은(보이는) 시리즈 값들의 합(없으면 null).
 * - TOTAL_LABEL_ANCHOR: 합계 레이블 앵커 막대의 무한소 값(스택 최상단 0-height 세그먼트 유지).
 */
export { sumVisibleStack, TOTAL_LABEL_ANCHOR } from '@/components/oem-companies/common/chartStyle';
