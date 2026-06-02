'use client';

/**
 * 차트 공용 가로 범례.
 *
 * 기존에 `management/plan/PlanAchievementChart.tsx` 안에 export돼 있던 것을 중립 위치로 이동.
 * (차트 파일에서 UI 컴포넌트를 export하던 구조 해소. docs/chart-guide.md §6 제안 3)
 *
 * 사용자 지정 순서대로 칩(사각형/라인 + 라벨)을 그리고, `onToggle`이 있으면 클릭으로 시리즈를
 * hide 토글한다(끈 항목은 흐려지고 line-through). 폰트 16.
 */
export function LegendRow({
  items,
  hidden,
  onToggle,
}: {
  items: Array<{ key: string; label: string; shape: 'rect' | 'line'; color: string }>;
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-base font-medium">
      {items.map((it) => {
        const isHidden = hidden?.has(it.key) ?? false;
        const clickable = !!onToggle;
        return (
          <button
            key={it.key}
            type="button"
            onClick={clickable ? () => onToggle?.(it.key) : undefined}
            disabled={!clickable}
            className={`inline-flex items-center gap-1.5 transition-opacity ${
              isHidden ? 'opacity-40 line-through' : ''
            } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            style={{ color: it.color }}
            aria-pressed={!isHidden}
          >
            {it.shape === 'rect' ? (
              <span className="inline-block w-4 h-4 rounded-sm" style={{ background: it.color }} />
            ) : (
              <span className="inline-block w-5 h-0.5 relative" style={{ background: it.color }}>
                <span
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-block w-2 h-2 rounded-full"
                  style={{ background: it.color }}
                />
              </span>
            )}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
