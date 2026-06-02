import type { PowerTrain } from '@/lib/types';

/**
 * 차트 공용 색상 팔레트 (도메인 중립).
 *
 * OEM·경영관리 등 여러 도메인이 공유하므로 `components/oem/helpers.ts`가 아니라 여기에 둔다.
 * (oem/helpers는 하위호환을 위해 이 파일을 re-export. docs/chart-guide.md §6 제안 4)
 */

/** 다중 시리즈 기본 팔레트 (테마 호환 hex, 시각적으로 구분 명확). 차트 전반 공용. */
export const OEM_COLORS = [
  '#2563eb', // blue-600
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#f59e0b', // amber-500
  '#9333ea', // purple-600
  '#0891b2', // cyan-600
  '#ea580c', // orange-600
  '#65a30d', // lime-600
  '#db2777', // pink-600
  '#475569', // slate-600
];

/** PowerTrain별 색상 (전동화 정도 그라데이션) */
export const PT_COLORS: Record<PowerTrain, string> = {
  ICE: '#94a3b8', // slate-400
  HV: '#fbbf24', // amber-400
  PHEV: '#fb923c', // orange-400
  EV: '#22c55e', // green-500
  FCV: '#06b6d4', // cyan-500
  Other: '#cbd5e1', // slate-300
};

/** PowerTrain 정렬 순위 (스택/리스트용) */
export const PT_ORDER: PowerTrain[] = ['ICE', 'HV', 'PHEV', 'EV', 'FCV', 'Other'];
