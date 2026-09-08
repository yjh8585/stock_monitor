/**
 * OEM 대시보드 공용 연도 상수/도출값.
 *
 * - `DATA_START_YEAR`: MarkLines 판매 데이터 수집이 시작된 고정 연도 — 해가 바뀌어도 변하지 않는다.
 * - `annualBarYears()`: TOP10 연간 막대차트 X축(`DATA_START_YEAR` ~ 진행 중인 현재 연도).
 *
 * 「직전 완결 연도」(연간 사전집계 비교용)는 `@/lib/oem/aggregate`의 `targetYear()`,
 * 「진행 중 연도(YTD)」는 `@/lib/currentYear`의 `currentYear()`를 그대로 쓴다 — 여기서 재정의하지 않는다.
 */
import { currentYear } from '@/lib/currentYear';

/** 판매 데이터 수집 시작 연도 (고정 — MarkLines 데이터가 이 해부터 존재) */
export const DATA_START_YEAR = 2020;

/** TOP10 OEM 연간 판매량 차트 X축: DATA_START_YEAR ~ 진행 중인 현재 연도 */
export function annualBarYears(): number[] {
  const years: number[] = [];
  for (let y = DATA_START_YEAR; y <= currentYear(); y++) years.push(y);
  return years;
}
