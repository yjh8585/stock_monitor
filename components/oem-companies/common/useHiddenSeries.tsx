'use client';

import type { MouseEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';

/**
 * recharts Legend 클릭으로 시리즈 hide/show 토글하는 공용 훅.
 *
 * 사용 패턴:
 *   const { isHidden, legendProps } = useHiddenSeries();
 *   <Legend {...legendProps} />
 *   <Bar dataKey="x" hide={isHidden('x')} />
 */

/** recharts LegendPayload 의 호환 형태 (구조적 부분). dataKey 는 함수형도 허용. */
export interface LegendClickPayload {
  value?: string | undefined;
  dataKey?: string | number | ((obj: unknown) => unknown) | undefined;
}

export interface UseHiddenSeriesResult {
  /** 현재 숨겨진(hide) 시리즈 키 집합 — 누적막대 합계 동적 계산용. */
  hidden: ReadonlySet<string>;
  /** 해당 시리즈 키가 hide 상태면 true. */
  isHidden: (key: string) => boolean;
  /** 시리즈 키 토글 (켜져있으면 끄고, 꺼져있으면 켬). */
  toggle: (key: string) => void;
  /** Legend 컴포넌트에 펼쳐서 적용할 props (onClick + formatter). */
  legendProps: {
    onClick: (data: LegendClickPayload, index: number, event: MouseEvent<HTMLElement>) => void;
    formatter: (value: string, entry: LegendClickPayload, index: number) => React.ReactNode;
  };
}

/** dataKey가 함수면 키 추출 불가 → value로 fallback. */
function extractKey(payload: LegendClickPayload): string {
  const dk = payload.dataKey;
  if (typeof dk === 'string' || typeof dk === 'number') return String(dk);
  return String(payload.value ?? '');
}

/**
 * recharts Legend 클릭 토글 + inactive 스타일 처리를 캡슐화.
 *
 * @param initialHidden 처음부터 꺼둘 시리즈 키(마운트 시 1회만 반영). 기본 전체 표시.
 */
export function useHiddenSeries(initialHidden?: readonly string[]): UseHiddenSeriesResult {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initialHidden ?? []));

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden]);

  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const legendProps = useMemo(
    () => ({
      onClick: (data: LegendClickPayload) => {
        const key = extractKey(data);
        if (!key) return;
        toggle(key);
      },
      formatter: (value: string, entry: LegendClickPayload) => {
        const key = extractKey(entry) || value;
        const isOff = hidden.has(key);
        return (
          <span
            style={{
              cursor: 'pointer',
              userSelect: 'none',
              textDecoration: isOff ? 'line-through' : 'none',
              opacity: isOff ? 0.5 : 1,
            }}
          >
            {value}
          </span>
        );
      },
    }),
    [hidden, toggle]
  );

  return { hidden, isHidden, toggle, legendProps };
}
