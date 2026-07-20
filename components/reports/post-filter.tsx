'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';

interface Props {
  categories: string[];
  sourceNames: string[];
}

/**
 * 게시판 필터 바 — 구분(youtube/report), 카테고리, 출처 드롭다운 + 제목 검색.
 * 필터 변경 시 page=1 로 초기화하고 나머지 searchParams 는 유지.
 * 검색은 키 입력마다 서버 왕복을 피하려고 Enter/돋보기 버튼 제출 방식.
 */
export function PostFilter({ categories, sourceNames }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSourceType = searchParams.get('sourceType') ?? '';
  const currentCategory = searchParams.get('category') ?? '';
  const currentSourceName = searchParams.get('sourceName') ?? '';
  const currentSearch = searchParams.get('search') ?? '';

  const [term, setTerm] = useState(currentSearch);
  // 뒤로가기 등으로 URL 의 search 가 바뀌면 입력창도 동기화(렌더 중 조정 — effect 불필요).
  const [syncedSearch, setSyncedSearch] = useState(currentSearch);
  if (currentSearch !== syncedSearch) {
    setSyncedSearch(currentSearch);
    setTerm(currentSearch);
  }

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

  const submitSearch = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      push('search', term.trim());
    },
    [push, term]
  );

  const clearSearch = useCallback(() => {
    setTerm('');
    push('search', '');
  }, [push]);

  const selectClass =
    'rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="flex flex-wrap items-center gap-2">
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

      <form onSubmit={submitSearch} role="search" className="relative flex items-center">
        <button
          type="submit"
          aria-label="제목 검색"
          className="text-muted-foreground hover:text-foreground absolute left-2 flex items-center"
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="제목 검색"
          aria-label="제목 검색어"
          className="border-input bg-background focus:ring-ring w-44 rounded-md border py-1.5 pr-8 pl-8 text-sm shadow-sm focus:ring-2 focus:outline-none"
        />
        {term && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="검색어 지우기"
            className="text-muted-foreground hover:text-foreground absolute right-2 flex items-center"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
