'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  page: number;
  totalPages: number;
  /** 페이지 링크가 향할 라우트. 기본은 게시판(`/reports`). */
  basePath?: string;
}

/** 페이지 버튼 URL — 현재 searchParams 를 유지하고 page 만 교체 */
function usePageHref(targetPage: number, basePath: string): string {
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  params.set('page', String(targetPage));
  return `${basePath}?${params.toString()}`;
}

function PageLink({
  page,
  current,
  basePath,
}: {
  page: number;
  current: number;
  basePath: string;
}) {
  const href = usePageHref(page, basePath);
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        buttonVariants({ variant: current === page ? 'default' : 'outline', size: 'sm' }),
        'min-w-[2.25rem]'
      )}
    >
      {page}
    </Link>
  );
}

/**
 * 게시판 페이지네이션.
 * 최대 7개 페이지 버튼 + 이전/다음 화살표.
 */
export function PostPagination({ page, totalPages, basePath = '/reports' }: Props) {
  const prevHref = usePageHref(page - 1, basePath);
  const nextHref = usePageHref(page + 1, basePath);

  if (totalPages <= 1) return null;

  const pages = buildPageRange(page, totalPages);

  return (
    <div className="flex items-center justify-center gap-1">
      <Link
        href={prevHref}
        scroll={false}
        aria-disabled={page <= 1}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          page <= 1 && 'pointer-events-none opacity-40'
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>

      {pages.map((p, i) =>
        p === null ? (
          <span key={`ellipsis-${i}`} className="text-muted-foreground px-1 text-sm">
            …
          </span>
        ) : (
          <PageLink key={p} page={p} current={page} basePath={basePath} />
        )
      )}

      <Link
        href={nextHref}
        scroll={false}
        aria-disabled={page >= totalPages}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          page >= totalPages && 'pointer-events-none opacity-40'
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/**
 * 1…4 5 6…10 형태의 페이지 배열 생성 (null = 줄임표).
 * 휴머노이드 증권사 리포트 표(클라이언트 페이지네이션)도 같은 모양을 써야 해서 내보낸다 —
 * 줄임표 규칙을 두 벌 두면 같은 페이지 수에서 모양이 갈린다.
 */
export function buildPageRange(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const result: (number | null)[] = [];
  const delta = 2;
  const left = Math.max(2, current - delta);
  const right = Math.min(total - 1, current + delta);

  result.push(1);
  if (left > 2) result.push(null);
  for (let i = left; i <= right; i++) result.push(i);
  if (right < total - 1) result.push(null);
  result.push(total);

  return result;
}
