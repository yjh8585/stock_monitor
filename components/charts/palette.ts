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

/**
 * 경영관리(`/management`) 막대 시리즈 전용 — **파란 계열 음영 스케일**.
 *
 * 사용자 지시(2026-07-15): 경영관리 차트 막대는 파란 계열 음영으로 통일한다.
 * 기존에 초록·주황·보라·분홍·황색이 섞여 페이지 전체에서 몇몇 차트만 튀었다.
 *
 * - 진남색 → 파랑 → 밝은 파랑 → 연한 파랑 순의 **명도 램프**라 누적막대에서 층 구분이 자연스럽다.
 * - 5번째부터는 파랑 명도만으로 구분이 한계라 **청록(cyan)** 으로 벌린다. 6계열을 넘어가면
 *   막대 색으로 구분하지 말고 차트를 쪼개는 것을 먼저 검토할 것.
 * - **막대 전용**이다. 달성율·YoY 등 강조 꺾은선은 대비가 필요하므로 `#dc2626`(빨강) 유지
 *   (docs/chart-guide.md §5-A).
 *
 * 시리즈 개수만큼 앞에서부터 쓴다: `MGMT_BAR_COLORS[i]`.
 */
export const MGMT_BAR_COLORS = [
  '#1e3a8a', // blue-900  진한 남색
  '#2563eb', // blue-600  기본 파랑
  '#60a5fa', // blue-400  밝은 파랑
  '#bfdbfe', // blue-200  연한 파랑
  '#0e7490', // cyan-700  청록 (파랑 명도만으론 5계열 구분 한계)
  '#67e8f9', // cyan-300  밝은 청록
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
