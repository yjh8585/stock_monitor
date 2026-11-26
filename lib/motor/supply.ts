/**
 * 모터 탭 공급 이력 셀의 순수 로직 — 컴포넌트(SupplyHistoryBadges)와 시험이 함께 쓴다.
 * (vitest 가 lib/ 아래만 돌기 때문에 컴포넌트 파일이 아니라 여기에 둔다)
 */
import type { SupplyField, SupplyRecord } from '@/lib/types';

/** 분야 칩 라벨 */
export const SUPPLY_FIELD_LABELS: Record<SupplyField, string> = {
  auto: '자동차',
  robot: '로봇',
  industrial: '산업',
};

/** 앞 max 건만 칩으로 보이고 나머지는 개수만 — 입력 순서 유지 */
export function summarizeSupply(
  records: SupplyRecord[],
  max: number
): { visible: SupplyRecord[]; hidden: number } {
  return {
    visible: records.slice(0, max),
    hidden: Math.max(0, records.length - max),
  };
}
