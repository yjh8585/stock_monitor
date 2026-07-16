import type { ReactElement } from 'react';

/**
 * "실측이 아닌 값" 표시용 대각 빗금 패턴 — 스텔란티스 탭 공용 시각 언어.
 *
 * 차트 2에서 2021~2025 Q2·Q4 출하는 반기·연간 보도자료에서 **차분 도출**한 값이라
 * 실측 분기와 한 차트에 섞인다(`isDerived`, ±1,000대 오차).
 *
 * 색을 바꿔 구분하면 경영관리 막대 색 규칙(`MGMT_BAR_COLORS` 파란 계열만, chart-guide §5-A)이
 * 깨진다. 그래서 **색은 그대로 두고 빗금으로만** 구분한다. 빗금 선을 카드 배경색(`stroke-card`)으로
 * 그어 밝은 막대(blue-200)·다크모드에서도 줄무늬가 보이게 했다.
 *
 * ⚠️ recharts는 자식 중 **SVG 엘리먼트만** 통과시키고 커스텀 컴포넌트는 렌더하지 않는다.
 * 따라서 `<HatchDefs />`(컴포넌트)가 아니라 **함수 호출**로 `<defs>` 엘리먼트 자체를 넘긴다:
 *   `<ComposedChart>{hatchDefs([{ id, color }])}...</ComposedChart>`
 */

/** 빗금 타일 한 변(px). 좁은 막대에서도 줄 2~3개가 보이는 최소치. */
const HATCH_TILE = 6;

/** 빗금 선 두께(px). 타일 6px 기준 약 1/3이 비도록 잡아 바탕색이 충분히 남는다. */
const HATCH_STROKE_WIDTH = 2;

/** 빗금 선 위치 = 타일 중앙. 가장자리(0)에 두면 타일 경계에서 절반이 잘린다. */
const HATCH_LINE_X = HATCH_TILE / 2;

export function hatchDefs(items: ReadonlyArray<{ id: string; color: string }>): ReactElement {
  return (
    <defs>
      {items.map(({ id, color }) => (
        <pattern
          key={id}
          id={id}
          patternUnits="userSpaceOnUse"
          width={HATCH_TILE}
          height={HATCH_TILE}
          patternTransform="rotate(45)"
        >
          <rect width={HATCH_TILE} height={HATCH_TILE} fill={color} />
          <line
            x1={HATCH_LINE_X}
            y1={0}
            x2={HATCH_LINE_X}
            y2={HATCH_TILE}
            strokeWidth={HATCH_STROKE_WIDTH}
            className="stroke-card"
          />
        </pattern>
      ))}
    </defs>
  );
}

/** `hatchDefs`로 정의한 패턴을 recharts `fill`에 물리는 URL 참조. */
export function hatchFill(id: string): string {
  return `url(#${id})`;
}
