import { Suspense } from 'react';

import { PostDetail } from '@/components/reports/post-detail';

/**
 * 기타 > 경영표준 상세 — 본문은 `/reports/[id]` 와 같은 `PostDetail` 을 쓰고,
 * 「목록」 버튼은 경영표준 목차로 돌아간다(`app/humanoid/reports/[id]` 와 같은 꼴).
 */
export async function generateStaticParams() {
  return [{ id: '0' }];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

async function Body({ params }: PageProps) {
  const { id } = await params;
  return <PostDetail id={id} backHref="/etc/mgmt-standard" />;
}

export default function MgmtStandardDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-6 text-sm">보고서 로딩 중…</div>}>
      {/* 좌우 여백은 layout.tsx 가 준다 — 여기선 위아래만 띄운다 */}
      <div className="py-2">
        <Body params={params} />
      </div>
    </Suspense>
  );
}
