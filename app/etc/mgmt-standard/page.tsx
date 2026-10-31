import Link from 'next/link';
import { cacheLife, cacheTag } from 'next/cache';
import { Suspense } from 'react';

import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccessConfidentialReports } from '@/lib/auth/permissions';
import { MGMT_STANDARD_CATEGORY, compareChapterTitle } from '@/lib/reports/mgmtStandard';
import { PostRepository } from '@/lib/reports/repositories/post.repository';

/**
 * 기타 > 경영표준 — 그룹웨어 경영표준을 정리한 보고서를 «장 목차»로 보여 준다.
 *
 * 게시판 목록(`PostList`)을 쓰지 않는 이유: 그 목록은 게시일·원문 발행일로만 정렬돼
 * 00장~11장·부록 순서를 세울 수 없다(계획 `docs/plans/2026-10-30-mgmt-standard.md` 결정 7).
 * 본문은 게시판과 같은 `PostDetail` 을 `[id]` 라우트에서 쓴다.
 */
const BASE_PATH = '/etc/mgmt-standard';
// 장 14편(00~11 + 부록 2)을 한 번에 담는다. 늘어나도 여유 있게.
const MAX_CHAPTERS = 100;

/**
 * 경영표준 글 목록을 Cache Components 로 캐싱.
 * includeConfidential 을 인자로 받아 역할별 캐시 엔트리를 가른다(`/reports` 와 같은 패턴) —
 * 글이 전부 사외비라 이 인자가 빠지면 목차가 통째로 비거나 새어 나간다.
 */
async function getChapters(includeConfidential: boolean) {
  'use cache';
  cacheLife('hours');
  cacheTag('posts');

  const repo = new PostRepository();
  const { rows } = await repo.list(1, MAX_CHAPTERS, {
    category: MGMT_STANDARD_CATEGORY,
    includeConfidential,
  });
  return [...rows].sort((a, b) => compareChapterTitle(a.title, b.title));
}

async function ChapterIndex() {
  // getCurrentUser 는 cookies() 를 쓰므로 'use cache' 함수 밖에서 호출한다.
  const currentUser = await getCurrentUser();
  const includeConfidential = currentUser ? canAccessConfidentialReports(currentUser.role) : false;
  const chapters = await getChapters(includeConfidential);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">경영표준 — 한세모빌리티는 어떻게 돌아가는가</h2>
        <p className="text-muted-foreground text-sm">
          그룹웨어 경영표준(매뉴얼·규칙·기준서)을 회사가 일하는 순서로 정리했습니다. 사외비.
        </p>
      </div>

      {chapters.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          게시된 경영표준 보고서가 아직 없습니다.
        </p>
      ) : (
        <ol className="divide-border border-border divide-y rounded-md border">
          {chapters.map((c) => (
            <li key={c.id}>
              <Link
                href={`${BASE_PATH}/${c.id}`}
                className="hover:bg-muted/60 block px-4 py-3 text-sm transition-colors"
              >
                {c.title}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function MgmtStandardPage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-6 text-sm">목차 로딩 중…</div>}>
      <ChapterIndex />
    </Suspense>
  );
}
