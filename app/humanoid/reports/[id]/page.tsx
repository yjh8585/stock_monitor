import { Suspense } from 'react';

import { PostDetail } from '@/components/reports/post-detail';

/**
 * 휴머노이드 > 보고서 상세 — 본문은 `/reports/[id]` 와 같은 `PostDetail` 을 쓰고
 * 휴머노이드 레이아웃(탭 네비) 안에서 보여 준다.
 *
 * 로봇 글은 게시판 목록에서 감췄으므로(사용자 지시 2026-09-11) 상세도 이쪽이 정식 경로다.
 * `/reports/<id>` 는 이미 공유된 링크가 깨지지 않게 그대로 살려 둔다.
 */
export async function generateStaticParams() {
  return [{ id: '0' }];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

async function Body({ params }: PageProps) {
  const { id } = await params;
  return <PostDetail id={id} backHref="/humanoid/reports" />;
}

export default function HumanoidReportDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-6 text-sm">보고서 로딩 중…</div>}>
      {/* 좌우 여백은 이 탭의 layout.tsx 가 준다 — 여기선 위아래만 띄운다 */}
      <div className="py-2">
        <Body params={params} />
      </div>
    </Suspense>
  );
}
