'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

interface Props {
  categories: string[];
  sourceNames: string[];
}

/**
 * 게시판 필터 바 — 구분(youtube/report), 카테고리, 출처 드롭다운.
 * 필터 변경 시 page=1 로 초기화하고 나머지 searchParams 는 유지.
 */
export function PostFilter({ categories, sourceNames }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSourceType = searchParams.get('sourceType') ?? '';
  const currentCategory = searchParams.get('category') ?? '';
  const currentSourceName = searchParams.get('sourceName') ?? '';

  const push = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set('page', '1');
      router.push(`/reports?${params.toString()}`);
    },
    [router, searchParams]
  );

  const selectClass =
    'rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={currentSourceType}
        onChange={(e) => push('sourceType', e.target.value)}
        className={selectClass}
        aria-label="구분 필터"
      >
        <option value="">전체 구분</option>
        <option value="youtube">유튜브</option>
        <option value="report">보고서</option>
      </select>

      <select
        value={currentCategory}
        onChange={(e) => push('category', e.target.value)}
        className={selectClass}
        aria-label="카테고리 필터"
      >
        <option value="">전체 카테고리</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={currentSourceName}
        onChange={(e) => push('sourceName', e.target.value)}
        className={selectClass}
        aria-label="출처 필터"
      >
        <option value="">전체 출처</option>
        {sourceNames.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
