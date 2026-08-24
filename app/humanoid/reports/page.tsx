import Link from 'next/link';
import { cacheLife, cacheTag } from 'next/cache';
import { Suspense } from 'react';

import { PostList } from '@/components/reports/post-list';
import { PostPagination } from '@/components/reports/post-pagination';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccessConfidentialReports } from '@/lib/auth/permissions';
import { PostRepository } from '@/lib/reports/repositories/post.repository';

/**
 * 휴머노이드 > 보고서 — 기존 posts 를 category='로봇' 으로 고정해 보여 준다.
 *
 * /reports 페이지를 복제하지 않고 조회 계층(PostRepository)과 목록 컴포넌트(PostList)만
 * 재사용한다. 카테고리·출처 필터는 두지 않는다 — 이 탭의 카테고리는 이미 '로봇' 하나로 고정이다.
 */
const PAGE_SIZE = 20;
const ROBOT_CATEGORY = '로봇';

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

function normalizePage(value: string | undefined): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * 로봇 카테고리 목록을 Cache Components 로 캐싱.
 * includeConfidential 을 인자로 받아 역할별 캐시 엔트리를 분리한다 —
 * 사외비 글이 권한 없는 사용자의 캐시로 새지 않게 하는 /reports 와 같은 패턴이다.
 */
async function getRobotReports(page: number, includeConfidential: boolean) {
  'use cache';
  cacheLife('hours');
  cacheTag('posts');

  const repo = new PostRepository();
  return repo.list(page, PAGE_SIZE, {
    sort: 'source_published_at',
    order: 'desc',
    category: ROBOT_CATEGORY,
    includeConfidential,
  });
}

async function RobotReportsBody({ searchParams }: PageProps) {
  const { page: rawPage } = await searchParams;
  const page = normalizePage(rawPage);

  // getCurrentUser 는 cookies() 를 쓰므로 'use cache' 함수 밖에서 호출한다.
  const currentUser = await getCurrentUser();
  const includeConfidential = currentUser ? canAccessConfidentialReports(currentUser.role) : false;

  const { rows, total } = await getRobotReports(page, includeConfidential);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-base font-semibold">로봇 보고서</h2>
          <p className="text-muted-foreground text-sm">
            전체 {total.toLocaleString()}건 ·{' '}
            <Link href="/reports?category=%EB%A1%9C%EB%B4%87" className="underline">
              보고서 게시판에서 보기
            </Link>
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          로봇 카테고리 보고서가 아직 없습니다.
        </p>
      ) : (
        <>
          <PostList
            rows={rows}
            total={total}
            startIndex={startIndex}
            sort="source_published_at"
            order="desc"
            filters={{ category: ROBOT_CATEGORY }}
          />
          <Suspense>
            <PostPagination page={page} totalPages={totalPages} />
          </Suspense>
        </>
      )}
    </div>
  );
}

export default function HumanoidReportsPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-6 text-sm">목록 로딩 중…</div>}>
      <RobotReportsBody searchParams={searchParams} />
    </Suspense>
  );
}
