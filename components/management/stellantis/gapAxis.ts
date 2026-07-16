/**
 * 갭(재고 증감) 꺾은선 축 domain 계산 — 차트 1·2 공용.
 *
 * 두 차트가 같은 질문("재고가 쌓이는가")에 다른 소스(월별 생산 / 분기 출하)로 답하므로
 * **축 문법이 같아야 눈으로 대조된다**. 그래서 한쪽에 두지 않고 모듈로 뺐다.
 */

/**
 * 꺾은선(재고 증감)이 차지할 plot 세로 밴드 — 아래에서부터의 비율.
 *
 * 막대 축이 `[0, max×2.5]`라 막대 top은 40%, 그 위 여유까지 약 48%다.
 * 그래서 선 밴드를 55%에서 시작해 두 그래프가 절대 겹치지 않게 한다(chart-guide §4-F 원칙).
 * 상단 95%는 dot·툴팁 커서가 잘리지 않게 남긴 여백.
 */
export const LINE_BAND = { bottom: 0.55, top: 0.95 } as const;

/**
 * 갭 축 domain.
 *
 * ⚠️ chart-guide §4-F의 표준 공식 `[-max×1.5, max×1.1]`을 **그대로 쓰지 않는 이유**:
 * 그 공식은 달성율·비율처럼 **0 이상 단일 부호 선**을 전제로 "0을 하단 58%에 두고 양수를 위로
 * 민다"는 계산이다. 반면 여기 갭(= 출하/생산 − 소매)은 **재고 소진 국면에서 음수**가 된다.
 * 음수 값에 그 공식을 적용하면 선이 0 아래로 내려가 막대 밴드(하단 40%)와 겹쳐,
 * §4-F가 막으려던 판독성 문제가 그대로 재발한다.
 *
 * 그래서 **§4-F의 '이중축 영역 분리' 원칙은 지키되 공식만 일반화**한다:
 * 갭의 실제 범위 [min, max](항상 0 포함)를 plot 상단 밴드 55~95%에 선형으로 사상한다.
 *  - 양수·음수가 모두 밴드 안에 들어오고, 0선은 밴드 내부의 제 위치에 자동으로 놓인다.
 *  - 단일 부호(min=0)면 결과가 `[-1.375×max, 1.125×max]`로 §4-F 공식과 사실상 동일해
 *    기존 콤보 차트(`PlanAchievementChart` 등)와 같은 인상을 준다. 즉 이 식은 §4-F의 상위집합이다.
 */
export function bandDomain(values: number[]): [number, number] {
  // 0을 항상 포함시켜 재고 축적/소진 기준선(ReferenceLine y=0)이 언제나 밴드 안에 보이게 한다.
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  // 전 구간 갭이 0인 엣지 케이스에서 span=0(0으로 나누기)이 되는 것을 막는다.
  const range = Math.max(max - min, 1);
  const span = range / (LINE_BAND.top - LINE_BAND.bottom);
  const lo = max - LINE_BAND.top * span;
  return [lo, lo + span];
}
