import { cacheLife, cacheTag } from 'next/cache';
import { Suspense } from 'react';

import { PostList } from '@/components/reports/post-list';
import { PostPagination } from '@/components/reports/post-pagination';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccessConfidentialReports } from '@/lib/auth/permissions';
import { PostRepository } from '@/lib/reports/repositories/post.repository';
import { ROBOT_CATEGORY } from '@/lib/reports/robot';
import { normalizeOrder, normalizeSort, type SortKey, type SortOrder } from '@/lib/reports/sort';

/**
 * 휴머노이드 > 보고서 — 기존 posts 를 category='로봇' 으로 고정해 보여 준다.
 *
 * /reports 페이지를 복제하지 않고 조회 계층(PostRepository)과 목록 컴포넌트(PostList)만
 * 재사용한다. 카테고리·출처 필터는 두지 않는다 — 이 탭의 카테고리는 이미 '로봇' 하나로 고정이다.
 */
const PAGE_SIZE = 20;
const BASE_PATH = '/humanoid/reports';

interface PageProps {
  // 🔴 정렬 파라미터를 «받는» 것까지가 배선이다. 이 셋이 없던 동안 PostList 가 만든
  //    정렬 링크는 URL 만 바꾸고 목록은 그대로였다(2026-09-11 수리).
  searchParams: Promise<{ page?: string; sort?: string; order?: string }>;
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
async function getRobotReports(
  page: number,
  sort: SortKey,
  order: SortOrder,
  includeConfidential: boolean
) {
  'use cache';
  cacheLife('hours');
  cacheTag('posts');

  const repo = new PostRepository();
  // `'use cache'` 는 인자를 캐시 키에 넣으므로 정렬 조합마다 엔트리가 갈린다.
  return repo.list(page, PAGE_SIZE, {
    sort,
    order,
    category: ROBOT_CATEGORY,
    includeConfidential,
  });
}

async function RobotReportsBody({ searchParams }: PageProps) {
  const { page: rawPage, sort: rawSort, order: rawOrder } = await searchParams;
  const page = normalizePage(rawPage);
  const sort = normalizeSort(rawSort);
  const order = normalizeOrder(rawOrder);

  // getCurrentUser 는 cookies() 를 쓰므로 'use cache' 함수 밖에서 호출한다.
  const currentUser = await getCurrentUser();
  const includeConfidential = currentUser ? canAccessConfidentialReports(currentUser.role) : false;

  const { rows, total } = await getRobotReports(page, sort, order, includeConfidential);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE;

  // 좌우 여백·최대 폭은 이 탭의 layout.tsx 가 준다(게시판 `/reports` 와 동일).
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-base font-semibold">로봇 보고서</h2>
          {/*
            게시판 링크를 두지 않는다 — 로봇 글은 게시판 목록에서 감췄으므로
            (사용자 지시 2026-09-11) 그 링크는 0건 화면으로 가는 죽은 길이 된다.
          */}
          <p className="text-muted-foreground text-sm">전체 {total.toLocaleString()}건</p>
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
            sort={sort}
            order={order}
            filters={{ category: ROBOT_CATEGORY }}
            basePath={BASE_PATH}
          />
          <Suspense>
            <PostPagination page={page} totalPages={totalPages} basePath={BASE_PATH} />
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
