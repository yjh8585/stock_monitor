import Link from 'next/link';
import { cacheLife, cacheTag } from 'next/cache';
import { Suspense } from 'react';

import { PostFilter } from '@/components/reports/post-filter';
import { PostList } from '@/components/reports/post-list';
import { PostPagination } from '@/components/reports/post-pagination';
import { buttonVariants } from '@/components/ui/button';
import { PostRepository } from '@/lib/reports/repositories/post.repository';
import type { PostSourceType } from '@/lib/reports/types';

const PAGE_SIZE = 20;

type SortKey = 'created_at' | 'source_published_at';
type SortOrder = 'asc' | 'desc';

interface ReportsPageProps {
  searchParams: Promise<{
    sort?: string;
    order?: string;
    page?: string;
    sourceType?: string;
    category?: string;
    sourceName?: string;
  }>;
}

function normalizeSort(value: string | undefined): SortKey {
  return value === 'created_at' ? 'created_at' : 'source_published_at';
}

function normalizeOrder(value: string | undefined): SortOrder {
  return value === 'asc' ? 'asc' : 'desc';
}

function normalizePage(value: string | undefined): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function normalizeSourceType(value: string | undefined): PostSourceType | undefined {
  return value === 'youtube' || value === 'report' ? value : undefined;
}

interface ListArgs {
  page: number;
  sort: SortKey;
  order: SortOrder;
  sourceType: PostSourceType | undefined;
  category: string | undefined;
  sourceName: string | undefined;
}

/**
 * 게시판 목록 + 필터 옵션을 Cache Components 로 캐싱.
 * cacheTag('posts') — 글 작성/삭제 시 revalidateTag 로 무효화.
 */
async function getPostsListData(args: ListArgs) {
  'use cache';
  cacheLife('hours');
  cacheTag('posts');

  const repo = new PostRepository();
  const [{ rows, total }, categories, sourceNames] = await Promise.all([
    repo.list(args.page, PAGE_SIZE, {
      sort: args.sort,
      order: args.order,
      sourceType: args.sourceType,
      category: args.category,
      sourceName: args.sourceName,
    }),
    repo.getDistinctCategories(),
    repo.getDistinctSourceNames(),
  ]);
  return { rows, total, categories, sourceNames };
}

async function ReportsBody({ searchParams }: ReportsPageProps) {
  const {
    sort: rawSort,
    order: rawOrder,
    page: rawPage,
    sourceType: rawSourceType,
    category,
    sourceName,
  } = await searchParams;

  const sort = normalizeSort(rawSort);
  const order = normalizeOrder(rawOrder);
  const page = normalizePage(rawPage);
  const sourceType = normalizeSourceType(rawSourceType);

  const { rows, total, categories, sourceNames } = await getPostsListData({
    page,
    sort,
    order,
    sourceType,
    category,
    sourceName,
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE;
  const filters = {
    sourceType: rawSourceType,
    category,
    sourceName,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">보고서</h1>
          <p className="text-muted-foreground text-sm">전체 {total.toLocaleString()}건</p>
        </div>
        <Link href="/reports/new" className={buttonVariants()}>
          + 글쓰기
        </Link>
      </div>

      <Suspense>
        <PostFilter categories={categories} sourceNames={sourceNames} />
      </Suspense>

      <PostList
        rows={rows}
        total={total}
        startIndex={startIndex}
        sort={sort}
        order={order}
        filters={filters}
      />

      <Suspense>
        <PostPagination page={page} totalPages={totalPages} />
      </Suspense>
    </div>
  );
}

export default function ReportsPage({ searchParams }: ReportsPageProps) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-6 text-sm">목록 로딩 중…</div>}>
      <ReportsBody searchParams={searchParams} />
    </Suspense>
  );
}
