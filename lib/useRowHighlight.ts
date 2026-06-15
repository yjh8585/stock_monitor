'use client';

import { useCallback, useState } from 'react';

/**
 * 표 행 강조 색 — 관련주식(`StockRow`)·손익(`PnlTable`) 표와 동일 톤.
 * 강조 시 행의 기존 배경(파랑 소계·회색 합계 등)을 덮어 노란 음영으로 표시한다.
 */
export const ROW_HIGHLIGHT_CLASS = 'bg-yellow-100/70 dark:bg-yellow-900/30';

/**
 * 표 행 클릭 시 노란색 음영 토글 상태 + 접근성 props.
 *
 * - `highlighted`: 강조된 행 key 집합
 * - `toggle(key)`: 단일 행 토글
 * - `rowToggleProps(key, label)`: `<tr>`에 펼치는 role/tabIndex/aria + 클릭·키보드 핸들러.
 *   버튼·링크·입력 등 인터랙티브 자식 클릭은 무시(모달·뉴스 버튼 보존).
 *
 * 관련주식·손익 표의 인라인 패턴을 공용화 — 6개 경영관리 표에서 재사용.
 */
export function useRowHighlight() {
  const [highlighted, setHighlighted] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((key: string) => {
    setHighlighted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const rowToggleProps = useCallback(
    (key: string, label: string) => ({
      role: 'button' as const,
      tabIndex: 0,
      'aria-pressed': highlighted.has(key),
      'aria-label': `${label} 행 — 클릭/Enter로 강조 토글`,
      onClick: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, a, input, select, [role="link"]')) return;
        toggle(key);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(key);
        }
      },
    }),
    [highlighted, toggle]
  );

  return { highlighted, toggle, rowToggleProps };
}
