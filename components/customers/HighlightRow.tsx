'use client';

import { cn } from '@/lib/utils';
import { ROW_HIGHLIGHT_CLASS, useRowHighlight } from '@/lib/useRowHighlight';

/**
 * 클릭하면 노란 음영이 켜지고 꺼지는 표 행 — 서버 컴포넌트 표(요약·물량·구성비)가 쓴다.
 * 표 전체를 'use client' 로 바꾸면 화면에 안 쓰는 사외비 칸까지 RSC payload 로 실리므로 행만 클라이언트로 둔다.
 * 칸(children)은 서버가 그린 그대로 · 링크·버튼 클릭은 훅이 무시한다.
 */
export default function HighlightRow({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { highlighted, rowToggleProps } = useRowHighlight();
  const on = highlighted.has('row');
  return (
    <tr
      {...rowToggleProps('row', label)}
      className={cn(className, 'cursor-pointer', on && ROW_HIGHLIGHT_CLASS)}
    >
      {children}
    </tr>
  );
}
